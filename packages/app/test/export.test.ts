import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type CanonicalProduct, type Proc123Config } from '@proc123/core';
import { readCsv } from '../../exporters/test/helpers.js';
import { confirmedProducts, priceForDisplay, readingsOf } from '../src/currency.js';
import { exportScan } from '../src/export.js';

function product(): CanonicalProduct {
  return {
    sourceUrl: 'https://shop.example/walnut/',
    kind: 'simple',
    name: 'گردو آزمایشی',
    categoryPath: ['آجیل', 'مغزها'],
    images: [],
    attributes: [],
    regularPrice: { amount: 240000, currency: 'IRR' },
    extractionMeta: { layer: 'B', fieldConfidence: {}, scannedAt: '2026-10-04T00:00:00Z' },
  };
}

function config(overrides: Partial<Proc123Config> = {}): Proc123Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe('confirmed app exports', () => {
  for (const exporter of ['woocommerce-csv', 'shopify-csv'] as const) {
    it(`matches the rial-source preview in ${exporter}`, () => {
      const outcome = exportScan(
        [product()],
        config({ exporter }),
        'rial',
        'https://shop.example/'
      );
      const row = readCsv(outcome.text).records[0];
      const column = exporter === 'woocommerce-csv' ? 'Regular price' : 'Price';
      expect(row?.[column]).toBe('24000');
      expect(Number(row?.[column])).toBe(readingsOf(240000, 'toman').rial);
      expect(Number(row?.[column])).toBe(
        priceForDisplay({ amount: 240000, currency: 'IRR' }, 'rial', 'toman').amount
      );
      expect(outcome.text.charCodeAt(0)).toBe(0xfeff);
    });
  }

  it('converts toman source to the configured rial destination', () => {
    const outcome = exportScan(
      [product()],
      config({ currency: { code: 'IRR', displayUnit: 'rial' } }),
      'toman',
      'https://shop.example/'
    );
    expect(readCsv(outcome.text).records[0]?.['Regular price']).toBe('2400000');
    expect(readingsOf(240000, 'rial')).toEqual({ toman: 2400000, rial: 240000 });
  });

  it('preserves stated units and scanned data, including sale prices', () => {
    const scanned = product();
    scanned.regularPrice = { amount: 240000, currency: 'IRR', unit: 'toman' };
    scanned.salePrice = { amount: 230000, currency: 'IRR' };
    const before = structuredClone(scanned);
    const outcome = exportScan([scanned], config(), 'rial', 'https://shop.example/');
    const row = readCsv(outcome.text).records[0];
    expect(row?.['Regular price']).toBe('240000');
    expect(row?.['Sale price']).toBe('23000');
    expect(scanned).toEqual(before);
  });

  it('rejects unanswered source units but honors known units without guessing', () => {
    expect(() => exportScan([product()], config(), undefined, '')).toThrow('Confirm');
    const scanned = product();
    scanned.regularPrice = { amount: 240000, currency: 'IRR', unit: 'toman' };
    const outcome = exportScan(
      [scanned],
      config({ currency: { code: 'IRR', displayUnit: 'rial' } }),
      undefined,
      ''
    );
    expect(readCsv(outcome.text).records[0]?.['Regular price']).toBe('2400000');
  });

  it('does not annotate non-Iranian prices or discard fractional toman', () => {
    const scanned = product();
    scanned.regularPrice = { amount: 1.99, currency: 'USD' };
    expect(confirmedProducts([scanned], 'rial')[0]?.regularPrice).toEqual(scanned.regularPrice);
    expect(readingsOf(240001).rial).toBe(24000.1);
  });

  it('records the confirmed source unit in JSON without changing its amount', () => {
    const outcome = exportScan(
      [product()],
      config({ exporter: 'json' }),
      'rial',
      'https://shop.example/'
    );
    expect(outcome.text).toContain('"unit": "rial"');
    expect(outcome.text).toContain('240000');
  });
});
