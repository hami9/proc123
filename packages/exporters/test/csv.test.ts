import { describe, expect, it } from 'vitest';

import { UTF8_BOM, escapeCsvField, toCsv } from '@proc123/exporters';

import { parseCsv } from './helpers.js';

describe('escapeCsvField', () => {
  it('leaves plain fields alone', () => {
    expect(escapeCsvField('walnut')).toBe('walnut');
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes fields containing the delimiter, quotes or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('does not escape backslashes', () => {
    // WooCommerce reads uploads with the escape character disabled, so a
    // backslash is literal — which is what `\,` inside a cell relies on.
    expect(escapeCsvField('C:\\path')).toBe('C:\\path');
    // The comma still forces quoting, but the backslash passes through as-is.
    expect(escapeCsvField('500\\,000')).toBe('"500\\,000"');
    expect(parseCsv(toCsv([['500\\,000']]))[0]?.[0]).toBe('500\\,000');
  });

  it('leaves formula-looking fields alone by default', () => {
    expect(escapeCsvField('-40% off')).toBe('-40% off');
    expect(escapeCsvField('=SUM(A1)')).toBe('=SUM(A1)');
  });

  it('can escape formulas when asked', () => {
    expect(escapeCsvField('=SUM(A1)', { escapeFormulas: true })).toBe("'=SUM(A1)");
    expect(escapeCsvField('@handle', { escapeFormulas: true })).toBe("'@handle");
    // Pure numbers cannot form a formula, so negative prices survive intact.
    expect(escapeCsvField('-42', { escapeFormulas: true })).toBe('-42');
    expect(escapeCsvField('-42.5', { escapeFormulas: true })).toBe('-42.5');
  });
});

describe('toCsv', () => {
  it('writes LF-terminated rows with a trailing newline', () => {
    expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\nc\n');
  });

  it('can write CRLF', () => {
    expect(toCsv([['a']], { eol: '\r\n' })).toBe('a\r\n');
  });

  it('prepends a BOM on request', () => {
    expect(toCsv([['a']], { bom: true })).toBe(`${UTF8_BOM}a\n`);
    expect(toCsv([['a']])).not.toContain(UTF8_BOM);
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('round-trips through a reader', () => {
    const rows = [
      ['Name', 'Description', 'Categories'],
      ['گردو', 'line one\nline two', 'آجیل > گردو'],
      ['Quote "test"', 'a,b', ''],
    ];
    expect(parseCsv(toCsv(rows, { bom: true }))).toEqual(rows);
  });
});
