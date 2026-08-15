# WooCommerce Store API — verified behaviour

Notes taken while implementing `packages/core/src/platform/woocommerce.ts`, by
reading the Store API source rather than the docs. CLAUDE.md §4 asks for exactly
this: "validate the response shape against current WooCommerce docs before
finalizing types; the namespace is stable but fields shift between releases."

Sources, all from `woocommerce/woocommerce` `trunk`, under
`plugins/woocommerce/src/StoreApi/`:

| Short name      | Path                               |
| --------------- | ---------------------------------- |
| **schema**      | `Schemas/V1/ProductSchema.php`     |
| **base-schema** | `Schemas/V1/AbstractSchema.php`    |
| **term-schema** | `Schemas/V1/TermSchema.php`        |
| **route**       | `Routes/V1/Products.php`           |
| **terms-route** | `Routes/V1/AbstractTermsRoute.php` |
| **query**       | `Utilities/ProductQuery.php`       |
| **pagination**  | `Utilities/Pagination.php`         |
| **money**       | `Formatters/MoneyFormatter.php`    |
| **currency**    | `Formatters/CurrencyFormatter.php` |

Checked against `trunk` on 2026-08-15.

---

## 1. The endpoint is genuinely public

**route** registers `GET /wc/store/v1/products` with
`'permission_callback' => '__return_true'`. No key, no nonce, no cookie. This is
the store publishing its own catalogue, which is why Layer A is preferred over
scraping wherever it exists.

## 2. Prices are integers in the smallest unit of the currency

**schema** describes `prices` as _"Price data provided using the smallest unit of
the currency"_, and **money** does the encoding:

```php
$value = $value * pow( 10, absint( $options['decimals'] ) );
$value = round( $value, 0, $options['rounding_mode'] );
```

So `"13500000"` with `currency_minor_unit: 2` is **135000.00**, not thirteen and
a half million. Decoding is `Number(price) / 10 ** currency_minor_unit`.

Reading the integer raw is a 100x error — an order of magnitude worse than the
toman/rial trap this project already guards against, and in the same silent way.
Iranian stores usually set decimals to 0, which makes the bug invisible on
exactly the catalogues this tool was built for and catastrophic everywhere else.

`""` is a real value meaning "no price" — a product that is not purchasable. It
must stay absent rather than becoming zero.

## 3. `currency_prefix` and `currency_suffix` are the toman/rial signal

**currency** builds them from the store's own currency-position setting and
`get_woocommerce_currency_symbol()`. A Persian store returns
`currency_suffix: " تومان"` alongside `currency_code: "IRR"`.

This is information Layer B cannot get. JSON-LD only ever says `IRR`, which says
nothing about the unit (see docs/structured-markup-notes.md §10). The adapter
runs the prefix and suffix through `detectCurrency`, so a Store API scan of a
Persian store needs no user confirmation at all.

## 4. A variable product's prices are the minimum across its variations

**schema**, `prepare_product_price_response()`:

```php
// If we have a variable product, get the price from the variations (this will use the min value).
if ( $product->is_type( ProductType::VARIABLE ) ) {
    $regular_price = $product->get_variation_regular_price();
```

So a variable parent's `prices.regular_price` is a range summary wearing a
price's clothing. Writing it to the parent row would be wrong twice over: it is
not that row's price, and WooCommerce requires variable parents to have empty
price cells anyway (docs/woocommerce-csv-notes.md, ROADMAP §6.5).

`price_range` is non-null only for `variable` and `grouped` products whose min
and max actually differ.

## 5. Variation attribute values are term slugs; the parent's are term names

This is the one that silently destroys an import.

The parent's `attributes[].terms[]` carries `{id, name, slug}` — `name` is the
display form, `۵۰۰ گرم`. The parent's `variations[]` array carries
`{id, attributes: [{name, value}]}`, and **schema**'s `get_variations()` builds
`value` from postmeta:

```sql
SELECT post_id as variation_id, meta_key as attribute_key, meta_value as attribute_value
```

For a global (taxonomy) attribute that meta value is the term **slug**,
`500-gram`. The same function's default-attribute check confirms it by comparing
`$term->slug === $default_attributes[...]`.

Exported untranslated, the CSV has a parent option list of `۵۰۰ گرم, ۱ کیلوگرم`
and variation values of `500-gram`, `1-kilogram`. WooCommerce matches those
character for character, fails, and drops every variation without an error.

The adapter therefore maps each variation value back through the parent's
`slug -> name` table. For a custom (non-taxonomy) attribute the schema sets
`slug = name`, so the same lookup is an identity and needs no special case.

A `value` of `null` means "any" for that axis. It is left off the row, which
produces an empty cell — which is exactly how WooCommerce spells "any".

## 6. Variations can be fetched, and that is the only way to get their prices

The parent's `variations[]` gives ids and attributes but no prices, no SKUs and
no stock. **route** accepts `type` with
`array_merge( array_keys( wc_get_product_types() ), [ ProductType::VARIATION ] )`,
and **query** turns it into a post-type switch:

```php
if ( ProductType::VARIATION === $request['type'] ) {
    $args['post_type'] = 'product_variation';
```

`parent` maps to `post_parent__in`. So `?type=variation&parent=<id>&per_page=100`
returns the variations as full product objects, prices included. One extra
request per variable product.

## 7. `category` takes a slug **or** a term ID, and guesses which from the first character

**query**:

```php
$type = is_numeric( $request[ $key ][0] ) ? 'term_id' : 'slug';
```

Two consequences.

Slugs can be passed straight through, so CLAUDE.md §4's instruction to resolve
the slug first is usually unnecessary work.

But a category whose slug is entirely numeric — `/product-category/2024/` is a
real thing on stores that file by year — gets matched against **term IDs**, and
silently returns the wrong products or none. That case, and only that case, has
to be resolved to a real term ID first.

## 8. `/products/categories` has no `slug` parameter

**terms-route**'s collection params are `context`, `page`, `per_page`, `search`,
`exclude`, `include`, `order`, `orderby`, `hide_empty`, `parent`. There is no
`slug`.

`?slug=nuts` is therefore not an error — it is silently ignored, and the endpoint
returns **every** category. Resolving a slug means paging the list and matching
client-side.

## 9. The term schema does expose `parent`, so hierarchy is recoverable

**term-schema** exposes `id`, `name`, `slug`, `description`, `parent`, `count`.

A product's own `categories[]` is a flat list of every category it belongs to,
with no hierarchy at all, so `Nuts > Walnuts` cannot be built from it. Fetching
the term list once and walking `parent` upwards from the deepest assigned
category is what makes a real `Categories` column possible.

## 10. Pagination is in headers

**pagination** sets `X-WP-Total` and `X-WP-TotalPages`, plus RFC 5988 `Link`
headers with `rel="prev"` / `rel="next"`. **route** caps `per_page` at 100 and
defaults it to 10 — the default is worth overriding on every request.

## 11. Fields the adapter deliberately does not map

- **`low_stock_remaining`** is set only when stock is low, so mapping it to
  `stockQuantity` would switch WooCommerce's stock management on for a scattered
  subset of the catalogue. An inconsistent `Stock` column is worse than an empty
  one (docs/woocommerce-csv-notes.md §11).
- **`price_html`** is a rendered string in the source store's locale and theme.
- **`description` / `short_description`** are kept as the HTML the API returns,
  because that is what both WooCommerce and Shopify accept back. `contentMode`
  decides whether they are exported at all.
- **`grouped` and `external` products** have no equivalent in `ProductKind` and
  are mapped to `simple`.
