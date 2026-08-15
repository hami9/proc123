/**
 * The whole point of the project, end to end: a page of HTML in, a CSV another
 * store can import out.
 *
 * These tests exist because the unit tests on either side can both pass while
 * the seam between them is wrong — a variation value that Layer B spells one
 * way and the exporter expects another produces a file that imports silently
 * and incompletely, which is the failure mode this project is most afraid of.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { type CanonicalProduct, assignSkus, extractStructured } from '@proc123/core';
import { exportWooCommerceCsv } from '@proc123/exporters';

import { readCsv } from './helpers.js';

const SCANNED_AT = '2026-08-15T09:00:00.000Z';

function fixture(name: string): string {
  return readFileSync(new URL(`../../core/test/fixtures/${name}`, import.meta.url), 'utf8');
}

/** The real pipeline: extract, then export. The exporter assigns missing SKUs. */
function pipeline(
  name: string,
  url: string,
  options: Parameters<typeof exportWooCommerceCsv>[1] = {}
) {
  const extraction = extractStructured(
    { url, html: fixture(name) },
    { scannedAt: SCANNED_AT, defaultCurrencyUnit: 'toman' }
  );
  const result = exportWooCommerceCsv(extraction.products, options);

  return { extraction, result, table: readCsv(result.csv) };
}

describe('a single product page becomes one importable row', () => {
  const { result, table } = pipeline(
    'woo-product.html',
    'https://ajil.example/product/walnut-500/'
  );
  const row = table.records[0];

  it('writes canonical English headers, not the source store’s locale', () => {
    expect(table.header.slice(0, 6)).toEqual([
      'ID',
      'Type',
      'SKU',
      'Name',
      'Published',
      'Is featured?',
    ]);
  });

  it('writes exactly one data row', () => {
    expect(result.rowCount).toBe(1);
  });

  it('carries the sale through as a separate regular and sale price', () => {
    expect(row?.['Regular price']).toBe('1500000');
    expect(row?.['Sale price']).toBe('1350000');
  });

  it('never carries an ID over from the source store', () => {
    expect(row?.['ID']).toBe('');
  });

  it('writes the category path with WooCommerce’s own separator', () => {
    expect(row?.['Categories']).toBe('آجیل > گردو');
  });

  it('joins images with a comma, the way the importer splits them', () => {
    expect(row?.['Images']).toBe(
      'https://cdn.ajil.example/walnut-1.jpg, https://cdn.ajil.example/walnut-2.jpg'
    );
  });

  it('converts the weight into the target store’s unit', () => {
    // The page says 500 g; the store's column is kg.
    expect(row?.['Weight (kg)']).toBe('0.5');
  });

  it('leaves the description empty in the default content mode', () => {
    expect(row?.['Description']).toBe('');
    expect(row?.['Short description']).toBe('');
  });

  it('includes the description when the user opts in', () => {
    const referenced = pipeline('woo-product.html', 'https://ajil.example/product/walnut-500/', {
      contentMode: 'reference',
    });
    expect(referenced.table.records[0]?.['Description']).toContain('تویسرکان');
    expect(referenced.table.records[0]?.['Meta: _proc123_source_url']).toBe(
      'https://ajil.example/product/walnut-500'
    );
  });

  it('keeps the store’s own SKU rather than inventing one', () => {
    expect(row?.['SKU']).toBe('AJ-WAL-500');
    expect(result.stats.skusGenerated).toBe(0);
  });

  it('reports how the prices were quoted so the unit can be confirmed', () => {
    // The page said IRR without saying toman or rial; the run was told toman.
    // Both the regular and the sale price are counted.
    expect(result.stats.currencyUnits).toEqual({ toman: 2 });
  });
});

describe('a category page becomes one row per product', () => {
  const { extraction, result, table } = pipeline(
    'woo-category.html',
    'https://ajil.example/product-category/nuts/'
  );

  it('generates a deterministic SKU for every product that had none', () => {
    // Scraped products rarely carry a SKU, and every row needs a unique one.
    expect(result.stats.skusGenerated).toBe(2);
    for (const record of table.records) {
      expect(record['SKU']).toMatch(/^P123-[0-9a-z]{8}$/);
    }
  });

  it('generates the same SKUs on a second scan of the same catalogue', () => {
    const again = pipeline('woo-category.html', 'https://ajil.example/product-category/nuts/');
    expect(again.table.records.map((record) => record['SKU'])).toEqual(
      table.records.map((record) => record['SKU'])
    );
  });

  it('gives every row the category from the page breadcrumb', () => {
    for (const record of table.records) {
      expect(record['Categories']).toBe('آجیل');
    }
  });

  it('hands the links it could not describe back for the next pass', () => {
    expect(extraction.discoveredUrls).toHaveLength(2);
    expect(extraction.products).toHaveLength(2);
  });

  it('derives the SKU from the product URL, not from the page it was found on', () => {
    // Re-scanning through a different listing page must update, not duplicate.
    const direct = assignSkus(extraction.products.slice(0, 1));
    expect(direct.products[0]?.sku).toBe(table.records[0]?.['SKU']);
  });
});

describe('a variable product becomes a parent row followed by its variations', () => {
  const { result, table } = pipeline(
    'productgroup-variants.html',
    'https://poshak.example/product/tshirt/'
  );

  it('writes the parent immediately before its own variation rows', () => {
    expect(table.records.map((record) => [record['Type'], record['SKU']])).toEqual([
      ['variable', 'TSHIRT'],
      ['variation', 'TSHIRT-RED-S'],
      ['variation', 'TSHIRT-RED-L'],
      ['variation', 'TSHIRT-BLUE-S'],
    ]);
  });

  it('links each variation to its parent by SKU, never by ID', () => {
    expect(table.records.slice(1).map((record) => record['Parent'])).toEqual([
      'TSHIRT',
      'TSHIRT',
      'TSHIRT',
    ]);
  });

  it('leaves the parent’s price columns empty, not zero', () => {
    expect(table.records[0]?.['Regular price']).toBe('');
    expect(table.records[0]?.['Sale price']).toBe('');
    expect(table.records[1]?.['Regular price']).toBe('480000');
  });

  it('lists every option on the parent and exactly one on each variation', () => {
    expect(table.records[0]?.['Attribute 1 name']).toBe('Color');
    expect(table.records[0]?.['Attribute 1 value(s)']).toBe('قرمز, آبی');
    expect(table.records[0]?.['Attribute 2 value(s)']).toBe('کوچک, بزرگ');

    expect(table.records[1]?.['Attribute 1 value(s)']).toBe('قرمز');
    expect(table.records[1]?.['Attribute 2 value(s)']).toBe('کوچک');
  });

  it('defaults attributes to local, so the import needs no taxonomy on the target', () => {
    expect(table.records[0]?.['Attribute 1 global']).toBe('0');
  });

  it('needs no repair, because the values already match character for character', () => {
    expect(result.warnings.filter((warning) => warning.code.startsWith('variation-'))).toEqual([]);
  });

  it('writes per-variation stock', () => {
    expect(table.records[1]?.['In stock?']).toBe('1');
    expect(table.records[2]?.['In stock?']).toBe('0');
  });

  it('never leaves Published or catalog visibility empty', () => {
    // Empty imports as a draft, and an empty visibility fails the row outright.
    for (const record of table.records) {
      expect(record['Published']).toBe('1');
      expect(record['Visibility in catalog']).toBe('visible');
    }
  });
});

describe('the units guard survives the whole pipeline', () => {
  const url = 'https://ajil.example/product/walnut-500/';

  function priceWith(unit: 'toman' | 'rial' | undefined): string {
    const extraction = extractStructured(
      { url, html: fixture('woo-product.html') },
      { scannedAt: SCANNED_AT, ...(unit === undefined ? {} : { defaultCurrencyUnit: unit }) }
    );
    const result = exportWooCommerceCsv(extraction.products, { displayUnit: 'toman' });
    return readCsv(result.csv).records[0]?.['Regular price'] ?? '';
  }

  it('converts rial to toman rather than exporting a 10x price', () => {
    expect(priceWith('toman')).toBe('1500000');
    expect(priceWith('rial')).toBe('150000');
  });

  it('warns when nothing on the page or in the settings named the unit', () => {
    const extraction = extractStructured(
      { url, html: fixture('woo-product.html') },
      { scannedAt: SCANNED_AT }
    );
    expect(extraction.issues.map((issue) => issue.code)).toContain('price-unit-unknown');

    const result = exportWooCommerceCsv(extraction.products);
    const assumed = result.warnings.find((warning) => warning.code === 'currency-unit-assumed');
    expect(assumed?.message).toContain('10x');
    // Both the regular and the sale price are unaccounted for.
    expect(result.stats.currencyUnits).toEqual({ unknown: 2 });
  });

  it('refuses to guess when the caller asks it not to', () => {
    const extraction = extractStructured(
      { url, html: fixture('woo-product.html') },
      { scannedAt: SCANNED_AT }
    );
    expect(() => exportWooCommerceCsv(extraction.products, { strictCurrencyUnit: true })).toThrow(
      /unit/i
    );
  });
});

describe('a page with nothing to extract', () => {
  it('produces an empty export rather than a file of blanks', () => {
    const { result, extraction } = pipeline(
      'no-markup.html',
      'https://outdoors.example/p/enamel-mug'
    );

    expect(extraction.products).toEqual([]);
    expect(result.rowCount).toBe(0);
    // The header is still written, so the file opens and explains itself.
    expect(result.columns.length).toBeGreaterThan(0);
  });
});

describe('scanning several pages into one export', () => {
  it('keeps SKUs unique across pages', () => {
    const pages: [string, string][] = [
      ['woo-product.html', 'https://ajil.example/product/walnut-500/'],
      ['woo-category.html', 'https://ajil.example/product-category/nuts/'],
      ['productgroup-variants.html', 'https://poshak.example/product/tshirt/'],
    ];

    const products: CanonicalProduct[] = pages.flatMap(
      ([name, url]) =>
        extractStructured({ url, html: fixture(name) }, { scannedAt: SCANNED_AT }).products
    );

    const { csv } = exportWooCommerceCsv(products);
    const skus = readCsv(csv).records.map((record) => record['SKU']);

    expect(skus).toHaveLength(7);
    expect(new Set(skus).size).toBe(7);
  });
});
