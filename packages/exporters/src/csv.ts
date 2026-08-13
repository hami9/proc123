/**
 * RFC 4180 CSV writing.
 *
 * WooCommerce reads uploads with `fgetcsv(..., '"', "\0")` — enclosure `"`,
 * escape character disabled — which is exactly RFC 4180, so a backslash in a
 * field is just a backslash. See docs/woocommerce-csv-notes.md.
 */

/** U+FEFF, written as a code point because a literal BOM is invisible in source. */
export const UTF8_BOM = String.fromCodePoint(0xfeff);

export interface CsvOptions {
  delimiter?: string;
  /** WooCommerce's own exporter writes LF, and its importer accepts either. */
  eol?: '\n' | '\r\n';
  /** Prepend a UTF-8 BOM so Excel opens the file as UTF-8. */
  bom?: boolean;
  /**
   * Prefix `'` to fields starting with `= + - @` tab or CR, the way
   * WooCommerce's *exporter* does.
   *
   * Off by default. WooCommerce's importer only strips that quote back off for
   * a handful of numeric columns, so turning this on corrupts any product name
   * that legitimately starts with `-`. Import fidelity beats spreadsheet
   * convenience for a file whose entire purpose is being imported.
   */
  escapeFormulas?: boolean;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvField(value: string, options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  let field = value;

  if (options.escapeFormulas === true && field !== '' && !NUMERIC.test(field)) {
    const first = [...field][0];
    if (first !== undefined && FORMULA_TRIGGERS.includes(first)) {
      field = `'${field}`;
    }
  }

  const needsQuotes =
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r');

  return needsQuotes ? `"${field.replaceAll('"', '""')}"` : field;
}

export function toCsv(rows: readonly (readonly string[])[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const eol = options.eol ?? '\n';

  const body = rows
    .map((row) => row.map((field) => escapeCsvField(field, options)).join(delimiter))
    .join(eol);

  const trailing = rows.length > 0 ? eol : '';
  return `${options.bom === true ? UTF8_BOM : ''}${body}${trailing}`;
}
