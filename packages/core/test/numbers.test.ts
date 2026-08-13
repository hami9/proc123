import { describe, expect, it } from 'vitest';

import {
  formatDecimal,
  parseNumber,
  parseNumberValue,
  roundTo,
  toAsciiDigits,
} from '@proc123/core';

describe('toAsciiDigits', () => {
  it('converts Persian (extended Arabic-Indic) digits', () => {
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts Arabic-Indic digits', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('leaves everything else alone', () => {
    expect(toAsciiDigits('گردو ۵۰۰ گرم')).toBe('گردو 500 گرم');
    expect(toAsciiDigits('abc123')).toBe('abc123');
  });

  it('does not corrupt characters outside the BMP', () => {
    expect(toAsciiDigits('👨‍👩‍👧 ۵')).toBe('👨‍👩‍👧 5');
  });
});

describe('parseNumber', () => {
  it('reads a plain integer', () => {
    expect(parseNumberValue('1500')).toBe(1500);
  });

  it('reads the Persian price format from the brief', () => {
    // CLAUDE.md §6 trap 8: `۱٬۵۰۰٬۰۰۰ تومان` must become 1500000.
    expect(parseNumberValue('۱٬۵۰۰٬۰۰۰ تومان')).toBe(1500000);
  });

  it.each([
    ['1,500,000', 1500000],
    ['1.500.000', 1500000],
    ['1 500 000', 1500000],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ["1'234.56", 1234.56],
    ['19.99', 19.99],
    ['19,99', 19.99],
    ['0.500', 0.5],
    ['0,500', 0.5],
    ['1234.567', 1234.567],
    ['.5', 0.5],
    ['-42', -42],
    ['1500,', 1500],
  ])('parses %j as %d', (input, expected) => {
    expect(parseNumberValue(input)).toBe(expected);
  });

  it('treats a lone three-digit group as thousands by default', () => {
    const parsed = parseNumber('1,500');
    expect(parsed).toEqual({ value: 1500, ambiguous: true });
  });

  it('can be told to read that group as a decimal instead', () => {
    // Weights and dimensions want this: `1,500` kg is 1.5, not 1500.
    expect(parseNumber('1,500', { ambiguousGrouping: 'decimal' })).toEqual({
      value: 1.5,
      ambiguous: true,
    });
  });

  it('flags only the genuinely ambiguous cases', () => {
    expect(parseNumber('1,500,000')?.ambiguous).toBe(false);
    expect(parseNumber('19.99')?.ambiguous).toBe(false);
    expect(parseNumber('1,234.56')?.ambiguous).toBe(false);
    expect(parseNumber('0.500')?.ambiguous).toBe(false);
    expect(parseNumber('1500')?.ambiguous).toBe(false);
  });

  it('pulls the number out of surrounding text', () => {
    expect(parseNumberValue('قیمت: ۱۲۵٬۰۰۰ تومان')).toBe(125000);
    expect(parseNumberValue('Price $1,299.00 USD')).toBe(1299);
    expect(parseNumberValue('وزن ۵۰۰ گرم')).toBe(500);
  });

  it('takes the first number from a price range', () => {
    expect(parseNumberValue('۱۰۰٬۰۰۰ - ۲۰۰٬۰۰۰ تومان')).toBe(100000);
  });

  it('survives bidi marks and non-breaking spaces from RTL themes', () => {
    expect(parseNumberValue('‫‏۱۵۰ ۰۰۰‬ تومان')).toBe(150000);
  });

  it('returns undefined rather than 0 when there is no number', () => {
    // An absent price must stay absent. Zero would import as a free product.
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('تماس بگیرید')).toBeUndefined();
    expect(parseNumber('Call for price')).toBeUndefined();
    expect(parseNumber('---')).toBeUndefined();
  });

  it('passes finite numbers through and rejects non-finite ones', () => {
    expect(parseNumber(42)).toEqual({ value: 42, ambiguous: false });
    expect(parseNumber(Number.NaN)).toBeUndefined();
    expect(parseNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('roundTo / formatDecimal', () => {
  it('kills floating point dust', () => {
    expect(roundTo(0.1 + 0.2, 6)).toBe(0.3);
    expect(formatDecimal(0.1 + 0.2)).toBe('0.3');
  });

  it('writes integers without a decimal point', () => {
    expect(formatDecimal(1500000)).toBe('1500000');
    expect(formatDecimal(0)).toBe('0');
  });

  it('never uses a comma or exponent notation', () => {
    expect(formatDecimal(1234567.5)).toBe('1234567.5');
    expect(formatDecimal(1e21)).toBe('1000000000000000000000');
    expect(formatDecimal(0.0000005)).not.toContain('e');
  });

  it('drops trailing zeros', () => {
    expect(formatDecimal(1.5)).toBe('1.5');
    expect(formatDecimal(1.5000001, 3)).toBe('1.5');
  });

  it('returns an empty string for non-finite input', () => {
    expect(formatDecimal(Number.NaN)).toBe('');
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe('');
  });
});
