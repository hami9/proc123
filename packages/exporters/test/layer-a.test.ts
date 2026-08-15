/**
 * Layer A end to end: a store's own API in, an importable CSV out.
 *
 * The two things worth proving across the seam are the ones that are silent
 * when they break — the toman/rial unit, and whether a variation's value still
 * matches its parent's option list after a round trip through the exporter.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { type HttpClient, scanCategory } from '@proc123/core';
import { exportWooCommerceCsv } from '@proc123/exporters';

import { readCsv } from './helpers.js';

const SCANNED_AT = '2026-08-15T09:00:00.000Z';
const PAGE_URL = 'https://ajil.example/shop/product-category/nuts/';

const html = readFileSync(
  new URL('../../core/test/fixtures/woo-store-api.html', import.meta.url),
  'utf8'
);

/** A Persian store: IRR, zero decimals, and تومان in its own currency suffix. */
const TOMAN = {
  currency_code: 'IRR',
  currency_symbol: 'تومان',
  currency_minor_unit: 0,
  currency_decimal_separator: '.',
  currency_thousand_separator: ',',
  currency_prefix: '',
  currency_suffix: ' تومان',
};

const PISTACHIO = {
  id: 102,
  name: 'پسته اکبری',
  type: 'variable',
  permalink: 'https://ajil.example/shop/product/pistachio/',
  sku: 'AJ-PIS',
  on_sale: false,
  prices: {
    ...TOMAN,
    price: '1800000',
    regular_price: '1800000',
    sale_price: '1800000',
    price_range: { min_amount: '1800000', max_amount: '3400000' },
  },
  images: [{ id: 2, src: 'https://cdn.ajil.example/pistachio.jpg' }],
  categories: [{ id: 16, name: 'پسته', slug: 'pistachio', link: '' }],
  tags: [],
  attributes: [
    {
      id: 4,
      name: 'وزن',
      taxonomy: 'pa_weight',
      has_variations: true,
      terms: [
        { id: 41, name: '۵۰۰ گرم', slug: '500-gram' },
        { id: 42, name: '۱ کیلوگرم', slug: '1-kilogram' },
      ],
    },
  ],
  // The trap: slugs here, display names on the parent above.
  variations: [
    { id: 501, attributes: [{ name: 'وزن', value: '500-gram' }] },
    { id: 502, attributes: [{ name: 'وزن', value: '1-kilogram' }] },
  ],
  is_in_stock: true,
};

const VARIATIONS = [501, 502].map((id, index) => ({
  id,
  name: 'پسته اکبری',
  parent: 102,
  type: 'variation',
  permalink: `https://ajil.example/shop/product/pistachio/?v=${String(id)}`,
  sku: id === 501 ? 'AJ-PIS-500' : 'AJ-PIS-1000',
  on_sale: false,
  prices: {
    ...TOMAN,
    price: index === 0 ? '1800000' : '3400000',
    regular_price: index === 0 ? '1800000' : '3400000',
    sale_price: index === 0 ? '1800000' : '3400000',
    price_range: null,
  },
  images: [],
  categories: [],
  tags: [],
  attributes: [],
  variations: [],
  is_in_stock: index === 0,
}));

const http: HttpClient = (request) => {
  const body = /type=variation/.test(request.url)
    ? VARIATIONS
    : /products\/categories/.test(request.url)
      ? [
          { id: 12, name: 'آجیل', slug: 'nuts', parent: 0 },
          { id: 16, name: 'پسته', slug: 'pistachio', parent: 12 },
        ]
      : [PISTACHIO];

  return Promise.resolve({
    status: 200,
    headers: { 'content-type': 'application/json', 'x-wp-totalpages': '1' },
    body: JSON.stringify(body),
    url: request.url,
  });
};

async function run(options: Parameters<typeof exportWooCommerceCsv>[1] = {}) {
  const scan = await scanCategory(
    { url: PAGE_URL, html },
    { scannedAt: SCANNED_AT, http, politeness: { delayMsBetweenRequests: 0 } }
  );
  const result = exportWooCommerceCsv(scan.products, options);
  return { scan, result, table: readCsv(result.csv) };
}

describe('a Store API scan becomes an importable CSV', () => {
  it('uses Layer A rather than the page markup', async () => {
    const { scan } = await run();
    expect(scan.layer).toBe('A');
    expect(scan.platform).toBe('woocommerce');
  });

  it('writes the parent immediately before its own variation rows', async () => {
    const { table } = await run();
    expect(table.records.map((record) => [record['Type'], record['SKU']])).toEqual([
      ['variable', 'AJ-PIS'],
      ['variation', 'AJ-PIS-500'],
      ['variation', 'AJ-PIS-1000'],
    ]);
  });

  it('leaves the variable parent’s price cells empty, not zero', async () => {
    const { table } = await run();
    expect(table.records[0]?.['Regular price']).toBe('');
    expect(table.records[1]?.['Regular price']).toBe('1800000');
    expect(table.records[2]?.['Regular price']).toBe('3400000');
  });

  it('carries the toman unit from the store’s settings with no warning', async () => {
    const { result } = await run({ displayUnit: 'toman' });
    // The store's own currency suffix said تومان, so nothing had to be assumed.
    expect(result.stats.currencyUnits).toEqual({ toman: 2 });
    expect(result.warnings.map((warning) => warning.code)).not.toContain('currency-unit-assumed');
  });

  it('converts to rial when the export asks for it', async () => {
    const { table } = await run({ displayUnit: 'rial' });
    expect(table.records[1]?.['Regular price']).toBe('18000000');
  });

  it('spells every variation value exactly as the parent lists it', async () => {
    const { result, table } = await run();

    expect(table.records[0]?.['Attribute 1 value(s)']).toBe('۵۰۰ گرم, ۱ کیلوگرم');
    expect(table.records[1]?.['Attribute 1 value(s)']).toBe('۵۰۰ گرم');
    expect(table.records[2]?.['Attribute 1 value(s)']).toBe('۱ کیلوگرم');

    // Had the adapter passed the API's raw slugs through, the exporter would
    // have had to repair them — and without repair WooCommerce drops the rows.
    expect(result.warnings.filter((warning) => warning.code.startsWith('variation-'))).toEqual([]);
  });

  it('builds the category path from the store’s term hierarchy', async () => {
    const { table } = await run();
    expect(table.records[0]?.['Categories']).toBe('آجیل > پسته');
  });

  it('keeps per-variation stock', async () => {
    const { table } = await run();
    expect(table.records[1]?.['In stock?']).toBe('1');
    expect(table.records[2]?.['In stock?']).toBe('0');
  });
});
