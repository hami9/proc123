/**
 * Phase 5 — variations read out of a WooCommerce variation form.
 *
 * Layers A and B already produce variations when the shop answers its own API
 * or publishes a `ProductGroup`. Neither is guaranteed, and the case this
 * covers is the common one: an SEO plugin emits JSON-LD describing the parent
 * and nothing else, while the add-to-cart form carries every variation inline.
 */

import { describe, expect, it } from 'vitest';

import type { CanonicalProduct } from '@proc123/core';
import { assignSkus, extractStructured, loadHtml, readVariationForm } from '@proc123/core';

import { page, SCANNED_AT } from './fixtures.js';

const URL_ = 'https://ajil.example/product/walnut/';

function scan(): CanonicalProduct[] {
  return extractStructured(page('woo-variable-form.html', URL_), {
    scannedAt: SCANNED_AT,
    defaultCurrencyUnit: 'toman',
  }).products;
}

function variations(products: readonly CanonicalProduct[]): CanonicalProduct[] {
  return products.filter((product) => product.kind === 'variation');
}

describe('reading a WooCommerce variation form', () => {
  it('turns one variable product into a parent and its variations', () => {
    const products = scan();
    const parents = products.filter((product) => product.kind === 'variable');

    expect(parents.length).toBe(1);
    expect(variations(products).length).toBe(3);
  });

  it('keeps the parent name from JSON-LD and the variations from the form', () => {
    // The point of the placement in `extractStructured`: neither source alone
    // describes the whole product.
    const products = scan();
    const parent = products.find((product) => product.kind === 'variable');

    expect(parent?.name).toBe('گردو ممتاز');
    expect(parent?.description ?? parent?.shortDescription).toContain('گردوی تازه');
    expect(variations(products).length).toBe(3);
  });

  it('maps term slugs back to the names the parent lists — CLAUDE.md §7.6', () => {
    // The whole reason this file exists. The variation JSON says `500g`; the
    // parent's options say `۵۰۰ گرم`. WooCommerce drops every variation on
    // import unless the two match character-for-character.
    const products = scan();
    const parent = products.find((product) => product.kind === 'variable');
    const axis = parent?.attributes.find((attribute) => attribute.isVariationAxis);

    expect(axis?.name).toBe('وزن');
    expect(axis?.values).toEqual(['۵۰۰ گرم', '۱ کیلوگرم', '۲ کیلوگرم']);

    const values = variations(products).flatMap((variation) =>
      variation.attributes.flatMap((attribute) => attribute.values)
    );
    // Every value a variation carries has to appear verbatim in the parent's list.
    for (const value of values) {
      expect(axis?.values).toContain(value);
    }
  });

  it('gives each variation exactly one value on the axis — §7.6', () => {
    for (const variation of variations(scan())) {
      const axis = variation.attributes.find((attribute) => attribute.isVariationAxis);
      expect(axis?.values.length).toBe(1);
    }
  });

  it('reads the per-variation price, SKU and stock', () => {
    const products = scan();
    const half = variations(products).find((variation) =>
      variation.attributes.some((attribute) => attribute.values.includes('۵۰۰ گرم'))
    );

    expect(half?.sku).toBe('WAL-500');
    expect(half?.regularPrice?.amount).toBe(460000);
    expect(half?.salePrice?.amount).toBe(420000);
    expect(half?.inStock).toBe(true);
  });

  it('carries a variation that is out of stock as out of stock', () => {
    const heaviest = variations(scan()).find((variation) => variation.sku === 'WAL-2000');
    expect(heaviest?.inStock).toBe(false);
  });

  it('leaves the variable parent with no price at all — §7.5', () => {
    // Empty, not zero. A parent price imports as a product sold at a figure the
    // shop never quoted.
    const parent = scan().find((product) => product.kind === 'variable');
    expect(parent?.regularPrice).toBeUndefined();
    expect(parent?.salePrice).toBeUndefined();
  });

  it('links every variation to its parent by SKU once SKUs are assigned — §7.2', () => {
    // Extraction deliberately leaves SKUs alone: `assignSkus` has to see a
    // whole scan at once to guarantee uniqueness across pages (§7.3), so the
    // parent has no SKU here and `parentSku` is filled at that step. Asserting
    // the link before it runs would be testing the wrong stage.
    //
    // §7.2 is what actually matters: the importer discards source IDs and
    // rebuilds the parent/child relationship from SKU alone, so a variation
    // whose `parentSku` does not name a parent row in the same file imports as
    // an orphan.
    const { products } = assignSkus(scan());
    const parent = products.find((product) => product.kind === 'variable');

    expect(parent?.sku).toBeDefined();
    const rows = variations(products);
    expect(rows.length).toBe(3);

    for (const variation of rows) {
      expect(variation.parentSku).toBe(parent?.sku);
      expect(variation.sku).toBeDefined();
    }

    // Every SKU in the file is unique, parent included.
    const skus = products.map((product) => product.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('says so plainly when the shop declined to inline the variations', () => {
    // WooCommerce writes `false` when its template opts out. Themes override
    // that template, so this is an ordinary outcome rather than a failure.
    const html = `<html><body>
      <form class="variations_form" data-product_variations="false"></form>
    </body></html>`;
    const reading = readVariationForm({ url: URL_, html }, {}, loadHtml(html));

    expect(reading.drafts).toEqual([]);
    expect(reading.issues.map((issue) => issue.code)).toContain('variation-form-not-inlined');
  });

  it('reports unreadable variation data rather than exporting nothing quietly', () => {
    const html = `<html><body>
      <form class="variations_form" data-product_variations="{not json"></form>
    </body></html>`;
    const reading = readVariationForm({ url: URL_, html }, {}, loadHtml(html));

    expect(reading.issues.map((issue) => issue.code)).toContain('variation-form-unreadable');
  });

  it('does not disturb a page that has no variation form', () => {
    // The regression that matters: this now runs on every Layer B page.
    const products = extractStructured(page('woo-product.html', 'https://ajil.example/p/1'), {
      scannedAt: SCANNED_AT,
    }).products;

    expect(products.length).toBeGreaterThan(0);
    expect(variations(products).length).toBe(0);
  });
});
