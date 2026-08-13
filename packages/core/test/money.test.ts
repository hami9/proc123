import { describe, expect, it } from 'vitest';

import {
  convertCurrencyUnit,
  detectCurrency,
  hasUnit,
  isIranianCurrency,
  parseMoney,
  toRial,
  type Money,
} from '@proc123/core';

describe('detectCurrency', () => {
  it('reads toman from Persian text', () => {
    expect(detectCurrency('۱۵۰٬۰۰۰ تومان')).toEqual({ currency: 'IRR', unit: 'toman' });
    expect(detectCurrency('۱۵۰٬۰۰۰ تومن')).toEqual({ currency: 'IRR', unit: 'toman' });
  });

  it('reads rial from Persian text, in both spellings', () => {
    expect(detectCurrency('۱٬۵۰۰٬۰۰۰ ریال')).toEqual({ currency: 'IRR', unit: 'rial' });
    // Arabic yeh spelling — folded to the Persian one before matching.
    expect(detectCurrency('۱٬۵۰۰٬۰۰۰ ريال')).toEqual({ currency: 'IRR', unit: 'rial' });
    expect(detectCurrency('۱٬۵۰۰٬۰۰۰ ﷼')).toEqual({ currency: 'IRR', unit: 'rial' });
  });

  it('does NOT infer a unit from the bare ISO code', () => {
    // This is the whole 10x trap: Iranian stores routinely tag toman prices as
    // IRR in JSON-LD. The code tells us the currency and nothing more.
    expect(detectCurrency('IRR 150000')).toEqual({ currency: 'IRR' });
    expect(detectCurrency('IRR 150000')?.unit).toBeUndefined();
  });

  it('prefers an explicit unit word over the ISO code', () => {
    expect(detectCurrency('IRR ۱۵۰٬۰۰۰ تومان')).toEqual({ currency: 'IRR', unit: 'toman' });
  });

  it('reads common non-Iranian currencies', () => {
    expect(detectCurrency('$1,299.00')).toEqual({ currency: 'USD' });
    expect(detectCurrency('1.299,00 €')).toEqual({ currency: 'EUR' });
    expect(detectCurrency('GBP 20')).toEqual({ currency: 'GBP' });
  });

  it('requires a word boundary for Latin codes', () => {
    // "irrigation" must not be read as IRR.
    expect(detectCurrency('irrigation kit 25')).toBeUndefined();
    expect(detectCurrency('50 usd')).toEqual({ currency: 'USD' });
  });

  it('returns undefined when the text names no currency', () => {
    expect(detectCurrency('1500')).toBeUndefined();
  });
});

describe('parseMoney', () => {
  it('parses a Persian toman price end to end', () => {
    const parsed = parseMoney('۱٬۵۰۰٬۰۰۰ تومان');
    expect(parsed?.money).toEqual({ amount: 1500000, currency: 'IRR', unit: 'toman' });
    expect(parsed?.unitFromSource).toBe(true);
  });

  it('leaves the unit undefined when the page does not say', () => {
    const parsed = parseMoney('150000', { defaultCurrency: 'IRR' });
    expect(parsed?.money).toEqual({ amount: 150000, currency: 'IRR' });
    expect(parsed?.money.unit).toBeUndefined();
    expect(parsed?.unitFromSource).toBe(false);
  });

  it('applies defaultUnit only when the page is silent', () => {
    expect(parseMoney('150000', { defaultCurrency: 'IRR', defaultUnit: 'toman' })?.money).toEqual({
      amount: 150000,
      currency: 'IRR',
      unit: 'toman',
    });
    // An explicit word on the page always wins over the configured default.
    expect(
      parseMoney('۱۵۰٬۰۰۰ ریال', { defaultCurrency: 'IRR', defaultUnit: 'toman' })?.money
    ).toEqual({ amount: 150000, currency: 'IRR', unit: 'rial' });
  });

  it('does not attach a unit to non-Iranian currencies', () => {
    expect(parseMoney('$19.99', { defaultUnit: 'toman' })?.money).toEqual({
      amount: 19.99,
      currency: 'USD',
    });
  });

  it('reports grouping ambiguity so callers can warn', () => {
    expect(parseMoney('1,500 تومان')?.ambiguousGrouping).toBe(true);
    expect(parseMoney('1,500,000 تومان')?.ambiguousGrouping).toBe(false);
  });

  it('returns undefined for "call for price"', () => {
    expect(parseMoney('تماس بگیرید')).toBeUndefined();
  });
});

describe('toman / rial conversion', () => {
  const toman: Money = { amount: 150000, currency: 'IRR', unit: 'toman' };
  const rial: Money = { amount: 1500000, currency: 'IRR', unit: 'rial' };

  it('narrows correctly with hasUnit', () => {
    expect(hasUnit(toman)).toBe(true);
    expect(hasUnit({ amount: 1, currency: 'IRR' })).toBe(false);
  });

  it('multiplies by ten going from toman to rial', () => {
    expect(hasUnit(toman) && convertCurrencyUnit(toman, 'rial')).toEqual(rial);
  });

  it('divides by ten going from rial to toman', () => {
    expect(hasUnit(rial) && convertCurrencyUnit(rial, 'toman')).toEqual(toman);
  });

  it('round-trips without drift', () => {
    for (const amount of [1, 7, 999, 150000, 1234567, 0.5]) {
      const start: Money = { amount, currency: 'IRR', unit: 'toman' };
      if (!hasUnit(start)) throw new Error('unreachable');
      const round = convertCurrencyUnit(convertCurrencyUnit(start, 'rial'), 'toman');
      expect(round.amount).toBe(amount);
    }
  });

  it('is a no-op for the same unit', () => {
    expect(hasUnit(toman) && convertCurrencyUnit(toman, 'toman')).toEqual(toman);
  });

  it('does not rescale non-Iranian currencies', () => {
    const usd: Money = { amount: 19.99, currency: 'USD', unit: 'toman' };
    expect(hasUnit(usd) && convertCurrencyUnit(usd, 'rial').amount).toBe(19.99);
  });

  it('normalizes to rial for comparison', () => {
    expect(hasUnit(toman) && toRial(toman)).toBe(1500000);
    expect(hasUnit(rial) && toRial(rial)).toBe(1500000);
  });

  it('knows which currencies have units', () => {
    expect(isIranianCurrency('IRR')).toBe(true);
    expect(isIranianCurrency('irr')).toBe(true);
    expect(isIranianCurrency('IRT')).toBe(true);
    expect(isIranianCurrency('USD')).toBe(false);
  });
});
