# Structured markup — what stores publish, and what Layer B does with it

Notes taken while implementing `packages/core/src/extract`. Layer B reads three
notations of the same vocabulary — JSON-LD, Microdata and OpenGraph — and the
gap between what the specifications say and what storefronts emit is where every
interesting decision lives.

Two kinds of claim appear below and they are labelled, because they carry very
different weight:

- **Spec** — stated by schema.org, the HTML microdata specification, the Open
  Graph protocol, or Google's structured-data requirements. Re-checkable against
  those documents.
- **Decision** — a judgement this project made, with the reasoning. These are the
  ones to argue with.

References:

| Short name    | Where                                                           |
| ------------- | --------------------------------------------------------------- |
| **schema**    | <https://schema.org/Product>, `/Offer`, `/AggregateOffer`       |
| **microdata** | HTML Standard, "Microdata" section (`itemscope` / `itemprop`)   |
| **og**        | <https://ogp.me/> and its `product` vertical                    |
| **google**    | Google Search Central, "Product structured data" and "Merchant" |

---

## 1. The three notations share one vocabulary, so they share one mapper

**Decision.** `microdata.ts` converts the DOM into schema.org-shaped JSON and
hands it to `schema-product.ts`, which is the same code path JSON-LD uses. The
alternative — a second implementation of what `offers` means — is two chances to
get the sale-price rule wrong and two sets of tests that can drift apart.

OpenGraph is mapped separately in `opengraph.ts` because it is a genuinely
different vocabulary, not a different notation for schema.org.

## 2. Priority order is JSON-LD → Microdata → OpenGraph, resolved by confidence

**Decision.** Every source records what it found with a confidence
(`CONFIDENCE` in `extract/types.ts`); the highest wins per field, and ties keep
the earlier source. So a lower source fills gaps but never overrules one above
it, and `extractionMeta.fieldConfidence` says afterwards which won.

The ordering reflects how specific each notation is. JSON-LD is authored as
data. Microdata is authored as markup and picks up whatever the theme wrapped
around it. `og:title` routinely carries the site-name suffix (`Walnut — Example
Nuts`), which is exactly why it must not beat a JSON-LD `name`.

## 3. `@type` has four spellings and they all mean the same thing

**Spec.** `Product`, `schema:Product`, `http://schema.org/Product`,
`https://schema.org/Product`. It may also be an array — a bookshop emits
`["Product", "Book"]`. `normalizeType` reduces all of these to a bare lowercase
name, and `typesOf` always returns a list.

The same normalization applies to `availability` and `priceType` values, which
are enumeration members written the same four ways.

## 4. A product is a short list of types, not "anything with offers"

**Decision.** `PRODUCT_TYPES` is `Product`, `ProductGroup`, `ProductModel`,
`IndividualProduct`, `Book`, `Vehicle`, `Car`. Broadening it to "any node with an
`offers` property" is tempting and wrong: pages carry `Organization` and
`WebPage` nodes with a site-wide offer attached, and each one becomes a phantom
product named after the shop.

## 5. `@graph` and `@id` references

**Spec.** A JSON-LD block is an object, an array, or an object with a `@graph`
array. Nodes inside refer to each other by `@id`, and a reference is written
either as a bare string or as an object whose only key is `@id`.

`scanSchemaNodes` indexes every node that has an `@id` **and more than one key** —
the extra-key condition matters, because a page that contains both a bare
reference and the real node must not index the reference and shadow the real one.

## 6. Sale prices: schema.org has no "was / now" pair

**Spec.** `Offer.price` is the price you pay. The original price, when published
at all, is a `priceSpecification` whose `priceType` is `ListPrice` (or `MSRP`,
`StrikethroughPrice`, …). Most stores publish only `price`.

**Decision.** A list price counts only when it is strictly higher than the
current price. Plugins emit an equal one for products that are not on sale, and
`regular == sale` imports into WooCommerce as a permanent 0% markdown.

**Decision.** Prices merge as a pair, never field by field (`setPricePair`). If
JSON-LD says the price is 24 and an OpenGraph tag says "was 30, now 24", taking
the confident 24 as the regular price and the unconfident 24 as the sale price
produces exactly the 0% sale above. The higher-confidence source wins the whole
statement or none of it.

## 7. `AggregateOffer` is a range, and a range is not a price

**Spec.** A category page publishes `AggregateOffer` with `lowPrice`,
`highPrice` and `offerCount` for any product with more than one price.

**Decision.** The low end is recorded at `CONFIDENCE.weak` (0.35) with an
`info` issue naming both bounds. Recording it at full confidence would let a
listing page's "from" price silently become the product's price; recording
nothing would throw away a usable signal. Weak confidence means a later
per-product scan overwrites it without a contest.

When an `AggregateOffer` lists its member offers, those are read instead — its
low/high are a summary of the same numbers.

## 8. Availability has three vocabularies

**Spec.** schema.org: `InStock`, `InStoreOnly`, `OnlineOnly`,
`LimitedAvailability`, `PreOrder`, `BackOrder`, `SoldOut`, `OutOfStock`,
`Discontinued`. **og**: `instock`, `oos`, `preorder`. **google** Merchant feeds
leak `in_stock` and `available for order` into `availability` too.

All three are normalized by stripping separators and lowercasing.

**Decision.** `PreOrder` and `BackOrder` map to _in stock_. The store is taking
money for them; importing them as out of stock hides products the merchant is
actively selling. WooCommerce has a distinct `backorder` status that
`CanonicalProduct.inStock` cannot express yet — worth revisiting when Phase 5
touches the stock model.

## 9. Prices are read as thousands, measurements as decimals

**Spec.** JSON-LD `price` is supposed to be a plain number with `.` as the
decimal separator and no grouping.

**Decision.** It frequently is not — `"1,500"` and `"1.500"` both turn up, and
in a price they both mean fifteen hundred. `parseNumber` is called with
`ambiguousGrouping: 'thousands'` for prices, and the ambiguity is reported as a
`price-separator-ambiguous` warning rather than silently resolved.

Measurements take the opposite default: `readQuantity` uses
`ambiguousGrouping: 'decimal'`, because `1.500 kg` is a kilo and a half. Prices
group in the large direction, measurements in the small one.

## 10. `IRR` is not evidence of toman or rial

Iranian stores routinely tag toman prices as `IRR`. `parseMoney` sets
`Money.currency` from the code and leaves `Money.unit` undefined unless the page
says a word — so Layer B emits a `price-unit-unknown` warning rather than a
number that might be ten times wrong. See CLAUDE.md §7.8 and the exporter's
`stats.currencyUnits`.

## 11. `content` wins on any element, not just `<meta>`

**Spec.** The microdata specification gives per-element value rules: `<meta>`
uses `content`, media elements use `src`, `<a>`/`<link>` use `href`, `<data>` and
`<meter>` use `value`, `<time>` uses `datetime`, everything else uses its text.

**Decision.** A `content` attribute is honoured on _any_ element, which the
specification does not require. Themes write
`<span itemprop="price" content="1500">۱٬۵۰۰ تومان</span>`, and the
machine-readable half is the one that is safe to parse. **google**'s parser
behaves the same way.

## 12. Lazy-loaded images hide behind a placeholder

**Decision.** An `<img>` whose `src` is a `data:` URI is a lazy-loading
placeholder; the real URL is in `data-src`, `data-lazy-src`, `data-original`, or
the first entry of `srcset`. Following those is the difference between exporting
a catalogue with images and one without.

Any URL that is not `http(s)` after resolution is dropped — `data:`,
`javascript:`, and the `urn:` values that Microdata's `itemid` often holds. The
target store sideloads from these URLs, so an unfetchable one fails the import.

## 13. Variations: `ProductGroup` + `hasVariant`

**Spec.** The modern schema.org shape for a variable product is a `ProductGroup`
whose `variesBy` names the axes and whose `hasVariant` holds one `Product` per
combination. Axis values sit on the variant as properties (`color`, `size`, …).

**Decision.** The parent's option list is assembled _from the variants' own
values_, so the two match character for character by construction. WooCommerce
matches variation values against the parent's options byte for byte and silently
drops the ones that do not — the single most common way a variable-product
import loses rows. See docs/woocommerce-csv-notes.md §8.

**Decision.** When `variesBy` is absent, axes are inferred from the properties
the variants actually carry (`color`, `size`, `material`, `pattern`, `flavor`)
plus any `additionalProperty` names. Nothing else is guessed at.

**Decision.** Variations inherit the parent's `sourceUrl` even when the markup
gives them their own. `assignSkus` links a variation with no `parentSku` to the
parent sharing its URL, and at extraction time the parent's SKU may not exist
yet.

## 14. Breadcrumbs, and which crumbs are not categories

**Spec.** `BreadcrumbList.itemListElement` holds `ListItem`s with `position`,
`name` and `item`. `item` is a URL string or a node. Positions are authoritative;
serialization order is not, and pages do serialize them out of order.

**Decision.** The leading crumb is dropped when it is the site root — either its
resolved path is `/`, or its name folds to a known home word in one of several
languages. The trailing crumb is dropped when it folds equal to the product's
own name. An explicit `Product.category` outranks the trail, because a trail can
contain "Shop" and a category cannot.

## 15. `ItemList` publishes two different things

**Spec.** A category page's `ItemList` holds either whole `Product` nodes or
bare links, and mixes them freely — full nodes above the fold, links below.

**Decision.** Whole nodes become products; links become `discoveredUrls` for the
traversal phase to fetch. A URL that also produced a product is not listed twice.

## 16. Malformed JSON-LD is normal and must not be fatal

**Decision.** Plugins template JSON-LD with string concatenation, so a share of
it is not valid JSON. `parseJsonLenient` unwraps `<!-- -->` and `//<![CDATA[ ]]>`
guards, then attempts exactly one repair: removing commas that sit directly
before `}` or `]`, ignoring anything inside a string. That repair is
unambiguous, is what a template loop produces, and cannot change the meaning of
valid JSON, because valid JSON has no trailing commas. Anything else is reported
as a `parse-failed` error and the other blocks on the page are still read.

A repaired block also emits an `info` issue — search engines will have rejected
that markup outright, which the store's owner probably wants to know.

## 17. OpenGraph only ever describes one product

**Spec.** `og:type: product` marks a product page. A category page's OpenGraph
block describes the _category_.

**Decision.** No draft is produced unless `og:type` is a product type or a
`product:price:*` tag is present. Without that rule, every category page exports
a phantom product named after the shelf its products sit on.

**Decision.** `og:description` maps to `shortDescription`, not `description`. It
is an excerpt written for a social card, and putting it in the long description
column would misrepresent it as the product copy.

## 18. Sitemaps are parsed, never fetched

**Decision.** `parseSitemap` handles `<urlset>` and `<sitemapindex>` in one pass,
because a store's `/sitemap.xml` is whichever of the two it feels like and
callers should not have to guess before parsing. Namespaced children such as
`<image:loc>` are ignored — in XML mode the tag name is `image:loc`, which the
`loc` selector does not match, which is exactly what we want.

`htmlparser2` recovers from malformed input rather than throwing, so there is no
parse error to catch: a gzipped body or an HTML error page simply yields no
entries, which is reported as `sitemap-empty`.

Fetching belongs to the extension and the companion, along with the delay
between requests — and along with stopping when a site signals a block.
