/**
 * Encoding individual WooCommerce cell values.
 *
 * Each rule here mirrors a specific function in WooCommerce's importer; see
 * docs/woocommerce-csv-notes.md for the source references.
 */

/** Separator WooCommerce uses inside a single cell for Categories/Tags/Images/attribute values. */
const MULTI_VALUE_SEPARATOR = ', ';

/** Category hierarchy separator. WooCommerce offers no way to escape it. */
export const CATEGORY_SEPARATOR = ' > ';

/**
 * Escape a value going into a multi-value cell.
 *
 * `WC_Product_Importer::explode_values()` splits on `,` after replacing `\,`
 * with a placeholder, then trims each piece — so a literal comma must be
 * written `\,` and leading/trailing spaces are lost either way.
 */
export function escapeMultiValue(value: string): string {
  return value.trim().replaceAll(',', '\\,');
}

export function joinMultiValue(values: readonly string[]): string {
  return values.map(escapeMultiValue).join(MULTI_VALUE_SEPARATOR);
}

/** `['آجیل', 'گردو']` -> `آجیل > گردو`, with commas inside names escaped. */
export function formatCategoryPath(path: readonly string[]): string {
  return path
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .map(escapeMultiValue)
    .join(CATEGORY_SEPARATOR);
}

/**
 * `WC_Product_CSV_Importer::parse_description_field()` turns a literal `\n`
 * into a real newline. Doubling the backslash stops descriptions sprouting
 * spurious line breaks. Real newlines in the cell are unaffected — they are
 * carried by CSV quoting and arrive intact.
 */
export function escapeDescription(html: string): string {
  return html.replaceAll('\\n', '\\\\n');
}

/** WooCommerce boolean columns are `1` / `0`. */
export function formatBoolean(value: boolean): string {
  return value ? '1' : '0';
}
