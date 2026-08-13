# WooCommerce CSV importer — verified behaviour

Notes taken while implementing `packages/exporters`, by reading the WooCommerce
importer source rather than the user-facing docs. Every claim below has a file
and function reference so it can be re-checked when WooCommerce changes.

Sources, all from `woocommerce/woocommerce` `trunk`, under
`plugins/woocommerce/includes/`:

| Short name            | Path                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| **controller**        | `admin/importers/class-wc-product-csv-importer-controller.php`                    |
| **importer**          | `import/class-wc-product-csv-importer.php`                                        |
| **abstract-importer** | `import/abstract-wc-product-importer.php`                                         |
| **english-mappings**  | `admin/importers/mappings/default.php`                                            |
| **exporter**          | `export/abstract-wc-csv-exporter.php`, `export/class-wc-product-csv-exporter.php` |
| **product**           | `abstracts/abstract-wc-product.php`                                               |

Checked against `trunk` on 2026-08-13.

---

## 1. English headers auto-map on any store

`controller::auto_map_columns()` builds its mapping table from translated
strings, but **english-mappings** is hooked onto the same filter at priority 100
and adds the untranslated English names unconditionally. Header lookup is
`strtolower($field)` against a lowercased table, and headers are `trim()`ed on
read.

So canonical English headers auto-map on a store in any locale, and casing does
not matter. Localized headers only map on a store in that locale — which is why
proc123 emits English by default and puts localized output behind
`headerOverrides` (CLAUDE.md §7.1).

## 2. A UTF-8 BOM is safe

`importer::read_file()` calls `remove_utf8_bom()` on the first header cell. The
BOM required by CLAUDE.md §7.9 for Excel does not break the `ID` column mapping.

## 3. Columns that are **not** auto-mapped

`GTIN, UPC, EAN, or ISBN` (`global_unique_id`) and `Brands` appear in the
exporter's column list and in the import wizard's manual dropdown, but are
absent from `auto_map_columns()` and from **english-mappings**. A user has to map
them by hand. Both are opt-in in proc123 for that reason.

## 4. Weight and dimension headers carry the target store's unit

Both `controller::auto_map_columns()` and **english-mappings** build the header as
`sprintf('Weight (%s)', $weight_unit)` from the target store's
`woocommerce_weight_unit` / `woocommerce_dimension_unit` options. `Weight (kg)`
does not map on a store configured in `lbs`.

`WooCsvOptions.weightUnit` / `.dimensionUnit` set both the header text and the
conversion applied to the value.

## 5. Multi-value cells: `\,` escapes a comma, values are trimmed

`abstract-importer::explode_values()`:

```php
$value  = str_replace( '\\,', '::separator::', $value );
$values = explode( $separator, $value );
// ...then each value is trim()ed and the placeholder restored
```

Applies to `Categories`, `Tags`, `Images`, `Attribute N value(s)`, `Upsells`,
`Cross-sells` and `Grouped products`. Leading/trailing whitespace inside a value
cannot survive, so proc123 trims before writing.

`Categories` additionally splits on `>` (`importer::parse_categories_field()`)
with **no escape available** — a category name containing `>` is unrepresentable,
so the exporter warns instead.

## 6. Row order is load-bearing, and getting it wrong fails quietly

`abstract-importer::set_variation_data()` errors when the parent does not exist.
But before that, `importer::parse_relative_field()` has already handled the
`Parent` cell: for an unknown SKU it **creates a placeholder `simple` product**
with that SKU.

So a variation row that appears before its parent does not error out. It gets
attached to a placeholder simple product, and then
`get_variation_parent_attributes()` finds no attributes on it, so every
attribute hits the `continue` at `set_variation_data()` and the variation is
imported **with no attributes at all**.

Silent, and hard to notice until customers cannot pick a variant. Hence
CLAUDE.md §7.4, and hence proc123 drops orphan variations by default rather than
emitting rows that create stray placeholder products.

## 7. `is_variation` is inferred, not read from a column

There is no "used for variations" column. `set_product_data()` imports parent
attributes with `is_variation = 0`, and then each variation row runs
`get_variation_parent_attributes()`, which **flips the parent's matching
attribute to `set_variation(1)` and re-saves the parent**.

Matching is by `sanitize_title($attribute['name'])`, on both sides. If the
variation's attribute name does not sanitize to the same key as the parent's,
the attribute is skipped silently.

## 8. Variation values must match the parent's options exactly

`set_variation_data()` takes `current($attribute['value'])` — **the first value
only** — and for a local (non-taxonomy) attribute stores it verbatim. WooCommerce
then matches a variation to a parent option by exact string comparison.

`500 گرم` on the parent and `500g` on the variation produces a variation that
can never be selected. So does a non-breaking space on one side and a normal
space on the other.

`packages/exporters/src/woocommerce/attributes.ts` handles this: it cleans both
sides identically, aligns a variation value to the parent's spelling when the
two fold to the same string, and adds genuinely missing values to the parent's
option list — reporting every change as a warning.

## 9. An empty `Attribute N name` is safe

`importer::expand_data()` skips any attribute whose name is empty, so padding
narrow products with empty attribute cells does not create junk attributes.

## 10. Empty cells that do **not** mean "leave unchanged"

This is the subtlest group. Three columns change behaviour when written empty:

| Column                  | Empty value behaviour                                                                                                                                                            | Where                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `Published`             | `$statuses[''] ?? 'draft'` → **imports as a draft**                                                                                                                              | `importer::set_parsed_data()`       |
| `In stock?`             | `'' ? 'instock' : 'outofstock'` → **imports as out of stock**                                                                                                                    | `importer::set_parsed_data()`       |
| `Visibility in catalog` | not a valid option → `product_invalid_catalog_visibility` is raised, `set_props()` returns `WP_Error`, and `abstract-importer::process_item()` **throws, failing the whole row** | `product::set_catalog_visibility()` |

proc123 therefore always writes `1` for `Published`, always writes `1`/`0` for
`In stock?` (warning when it had to assume), and always writes `visible`.

Empty cells _are_ safe for `Categories`, `Images`, `Tags` (early `empty()`
return), for prices and dimensions (`wc_format_decimal('')` → `''`), for `Stock`
(turns stock management off), and for `Tax status` (defaults to `taxable`).

## 11. `Stock` drives `manage_stock`

`importer::set_parsed_data()`: a non-empty `Stock` sets `manage_stock = true`; an
empty one sets it to `false`. There is no separate manage-stock column to map.

## 12. A literal `\n` in a description becomes a real newline

`importer::parse_description_field()` replaces the two-character sequence `\n`
with an actual newline. Descriptions are escaped to `\\n` on export so they do
not sprout line breaks. Real newlines inside a quoted CSV cell are unaffected.

## 13. CSV dialect

- Read with `fgetcsv($handle, 0, $delimiter, '"', "\0")` — enclosure `"`, escape
  character **disabled**, i.e. plain RFC 4180. A backslash in a field is
  literal, which is what rule 5's `\,` depends on.
- WooCommerce's own exporter writes with `fputcsv(..., '"', "\0")`, so LF line
  endings.

## 14. Formula escaping is asymmetric — leave it off

`exporter::escape_data()` prefixes `'` to fields starting with `= + - @`, tab or
CR. `importer::unescape_data()` strips it back off only for a subset of columns
(comma fields, floats, ints, stock quantity, tax status, tags, published).

`name` uses `parse_skip_field` and never unescapes, so a product literally named
`-40% off Walnuts` round-trips through WooCommerce's own export/import as
`'-40% off Walnuts`. proc123 defaults `escapeFormulas` to `false`: this file
exists to be imported, and import fidelity beats spreadsheet safety. The option
is there for users who need the Excel guard.

## 15. `Published` accepts more than 1 and 0

`1` publish, `0` **private**, `-1` draft, `2` pending. `-1` on a variation row is
coerced to publish. Note that `0` is _private_, not "unpublished".
