import { describe, expect, it } from 'vitest';

import { type ExtractionResult, extractStructured } from '@proc123/core';

import { SCANNED_AT, byName, issueCodes, page } from './fixtures.js';

function scan(name: string, url: string, options = {}): ExtractionResult {
  return extractStructured(page(name, url), { scannedAt: SCANNED_AT, ...options });
}

describe('a WooCommerce product page', () => {
  const result = scan('woo-product.html', 'https://ajil.example/product/walnut-500/');
  const product = result.products[0];

  it('produces exactly one product', () => {
    expect(result.products).toHaveLength(1);
    expect(product?.kind).toBe('simple');
    expect(product?.sourceUrl).toBe('https://ajil.example/product/walnut-500');
  });

  it('reads the identity fields', () => {
    expect(product?.name).toBe('گردو با پوست ۵۰۰ گرم');
    expect(product?.sku).toBe('AJ-WAL-500');
    expect(product?.brand).toBe('آجیل نمونه');
    expect(product?.gtin).toBe('6260000000017');
  });

  it('reads the sale as a was/now pair, not as one price', () => {
    expect(product?.regularPrice).toEqual({ amount: 1500000, currency: 'IRR' });
    expect(product?.salePrice).toEqual({ amount: 1350000, currency: 'IRR' });
  });

  it('does not let the OpenGraph price overrule the JSON-LD pair', () => {
    // og:price is 1350000, the sale price. Taking it as the regular price would
    // wipe out the discount and permanently mark the product down.
    expect(product?.extractionMeta.fieldConfidence['regularPrice']).toBe(0.95);
  });

  it('leaves the toman/rial unit unset and says so', () => {
    expect(product?.regularPrice?.unit).toBeUndefined();
    expect(issueCodes(result.issues)).toContain('price-unit-unknown');
  });

  it('builds the category path from the breadcrumb, in position order', () => {
    // Serialized 1, 3, 2, 4; "خانه" is the site root and the last crumb is the
    // product itself.
    expect(product?.categoryPath).toEqual(['آجیل', 'گردو']);
  });

  it('dedupes images while keeping the main one first', () => {
    expect(product?.images).toEqual([
      'https://cdn.ajil.example/walnut-1.jpg',
      'https://cdn.ajil.example/walnut-2.jpg',
    ]);
  });

  it('reads the weight with its unit', () => {
    expect(product?.weight).toEqual({ value: 500, unit: 'g' });
  });

  it('reads the specification table as attributes', () => {
    expect(product?.attributes).toEqual([
      { name: 'نوع بسته‌بندی', values: ['وکیوم'], isVariationAxis: false },
      { name: 'استان', values: ['همدان'], isVariationAxis: false },
    ]);
  });

  it('reads keywords as tags', () => {
    expect(product?.tags).toEqual(['گردو', 'آجیل', 'خشکبار']);
  });

  it('merges the OpenGraph excerpt into the short description', () => {
    expect(product?.shortDescription).toBe('گردوی تازه با پوست، برداشت امسال، بسته‌بندی وکیوم.');
    expect(product?.description).toContain('تویسرکان');
  });

  it('stamps the layer and the scan time', () => {
    expect(product?.extractionMeta.layer).toBe('B');
    expect(product?.extractionMeta.scannedAt).toBe(SCANNED_AT);
  });

  it('applies an explicit unit default when the user has set one', () => {
    const withUnit = scan('woo-product.html', 'https://ajil.example/product/walnut-500/', {
      defaultCurrencyUnit: 'toman',
    });
    expect(withUnit.products[0]?.regularPrice).toEqual({
      amount: 1500000,
      currency: 'IRR',
      unit: 'toman',
    });
  });
});

describe('a category listing page', () => {
  const result = scan('woo-category.html', 'https://ajil.example/product-category/nuts/');

  it('produces one product per described item and no more', () => {
    expect(result.products.map((product) => product.name)).toEqual([
      'بادام درختی شور',
      'پسته اکبری',
    ]);
  });

  it('collects the links it could not describe for the traversal phase', () => {
    expect(result.discoveredUrls).toEqual([
      'https://ajil.example/product/hazelnut',
      'https://ajil.example/product/cashew',
    ]);
  });

  it('gives every product the page category', () => {
    for (const product of result.products) {
      expect(product.categoryPath).toEqual(['آجیل']);
    }
  });

  it('resolves relative product URLs against the page', () => {
    expect(byName(result.products, 'بادام درختی شور').sourceUrl).toBe(
      'https://ajil.example/product/almond'
    );
  });

  it('reports a price range instead of passing its low end off as a price', () => {
    const pistachio = byName(result.products, 'پسته اکبری');
    expect(pistachio.regularPrice?.amount).toBe(1800000);
    // Low confidence, so a later per-product scan overwrites it without a fight.
    expect(pistachio.extractionMeta.fieldConfidence['regularPrice']).toBe(0.35);

    const ranged = result.issues.find((issue) => issue.code === 'price-range-only');
    expect(ranged?.severity).toBe('info');
    expect(ranged?.message).toContain('3400000');
  });

  it('does not turn the category page itself into a product', () => {
    expect(result.products.some((product) => product.name.includes('فروشگاه'))).toBe(false);
  });
});

describe('a ProductGroup with variants', () => {
  const result = scan('productgroup-variants.html', 'https://poshak.example/product/tshirt/');

  it('emits the parent immediately before its own variation rows', () => {
    expect(result.products.map((product) => [product.kind, product.sku])).toEqual([
      ['variable', 'TSHIRT'],
      ['variation', 'TSHIRT-RED-S'],
      ['variation', 'TSHIRT-RED-L'],
      ['variation', 'TSHIRT-BLUE-S'],
    ]);
  });

  it('links every variation to the parent by SKU, never by id', () => {
    for (const variation of result.products.slice(1)) {
      expect(variation.parentSku).toBe('TSHIRT');
    }
  });

  it('leaves the parent without prices, because they live on the variations', () => {
    expect(result.products[0]?.regularPrice).toBeUndefined();
    expect(result.products[1]?.regularPrice).toEqual({ amount: 480000, currency: 'IRR' });
  });

  it('lists every axis value on the parent and exactly one on each variation', () => {
    expect(result.products[0]?.attributes).toEqual([
      { name: 'Color', values: ['قرمز', 'آبی'], isVariationAxis: true },
      { name: 'Size', values: ['کوچک', 'بزرگ'], isVariationAxis: true },
      { name: 'جنس', values: ['نخ پنبه'], isVariationAxis: false },
    ]);

    expect(result.products[1]?.attributes).toEqual([
      { name: 'Color', values: ['قرمز'], isVariationAxis: true },
      { name: 'Size', values: ['کوچک'], isVariationAxis: true },
    ]);
  });

  it('spells every variation value exactly as the parent lists it', () => {
    // WooCommerce matches these character for character; a mismatch silently
    // drops the variation on import. See CLAUDE.md §7.6.
    const options = new Map(
      (result.products[0]?.attributes ?? []).map((attribute) => [attribute.name, attribute.values])
    );

    for (const variation of result.products.slice(1)) {
      for (const attribute of variation.attributes) {
        expect(options.get(attribute.name)).toContain(attribute.values[0]);
      }
    }
  });

  it('gives every variation the parent name and the parent URL', () => {
    for (const variation of result.products.slice(1)) {
      expect(variation.name).toBe('تی‌شرت نخی');
      expect(variation.sourceUrl).toBe('https://poshak.example/product/tshirt');
    }
  });

  it('keeps per-variation stock and inventory', () => {
    expect(result.products[1]?.inStock).toBe(true);
    expect(result.products[1]?.stockQuantity).toBe(12);
    expect(result.products[2]?.inStock).toBe(false);
  });

  it('does not emit the variants a second time as standalone products', () => {
    expect(result.products.filter((product) => product.kind !== 'variation')).toHaveLength(1);
  });
});

describe('a Microdata-only page', () => {
  const result = scan('microdata-product.html', 'https://spice.example/product/saffron-5g/');
  const product = result.products[0];

  it('produces the product', () => {
    expect(result.products).toHaveLength(1);
    expect(product?.name).toBe('زعفران سرگل ۵ گرم');
    expect(product?.sku).toBe('SAF-5');
    expect(product?.brand).toBe('زعفران نمونه');
  });

  it('takes the price from the content attribute, not the Persian display text', () => {
    expect(product?.regularPrice).toEqual({ amount: 4200000, currency: 'IRR' });
    expect(product?.inStock).toBe(true);
  });

  it('finds the real image behind the lazy-loading placeholder', () => {
    expect(product?.images).toEqual(['https://spice.example/img/saffron-5g.jpg']);
  });

  it('reads a weight pulled in through itemref', () => {
    expect(product?.weight).toEqual({ value: 5, unit: 'g' });
  });

  it('reads the breadcrumb trail', () => {
    expect(product?.categoryPath).toEqual(['ادویه', 'زعفران']);
  });

  it('records microdata as the source of every field', () => {
    expect(product?.extractionMeta.fieldConfidence['name']).toBe(0.7);
  });
});

describe('a page with broken JSON-LD', () => {
  const result = scan('broken-jsonld.html', 'https://kitchen.example/p/cast-iron-26');

  it('still reads the block that was valid', () => {
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.name).toBe('Cast Iron Skillet 26cm');
  });

  it('reports the block it could not parse', () => {
    const failure = result.issues.find((issue) => issue.code === 'json-ld-invalid');
    expect(failure?.severity).toBe('error');
    expect(failure?.kind).toBe('parse-failed');
  });

  it('repairs a trailing comma and says it did', () => {
    expect(issueCodes(result.issues)).toContain('json-ld-repaired');
  });

  it('says when a price separator could have been read either way', () => {
    expect(result.products[0]?.regularPrice).toEqual({ amount: 1250, currency: 'TRY' });
    const ambiguous = result.issues.find((issue) => issue.code === 'price-separator-ambiguous');
    expect(ambiguous?.severity).toBe('warning');
  });

  it('reads dimensions written three different ways', () => {
    expect(result.products[0]?.dimensions).toEqual({
      length: { value: 26, unit: 'cm' },
      width: { value: 26, unit: 'cm' },
      height: { value: 5, unit: 'cm' },
    });
  });

  it('does not complain about an empty script block', () => {
    expect(result.issues.filter((issue) => issue.code === 'json-ld-invalid')).toHaveLength(1);
  });
});

describe('a page with no structured markup', () => {
  const result = scan('no-markup.html', 'https://outdoors.example/p/enamel-mug');

  it('invents nothing', () => {
    expect(result.products).toEqual([]);
    expect(result.discoveredUrls).toEqual([]);
  });

  it('says what happened and what to do about it', () => {
    const issue = result.issues.find((entry) => entry.code === 'no-structured-data');
    expect(issue?.severity).toBe('info');
    expect(issue?.message).toContain('Selector Learning Mode');
  });
});

describe('an OpenGraph-only page', () => {
  const result = scan('og-only-product.html', 'https://coffee.example/shop/moka-pot-6');
  const product = result.products[0];

  it('produces the product from meta tags alone', () => {
    expect(product?.name).toBe('Copper Moka Pot 6 Cup');
    expect(product?.sku).toBe('MOKA-6');
    expect(product?.brand).toBe('Example Coffee');
    expect(product?.weight).toEqual({ value: 0.9, unit: 'kg' });
  });

  it('reads the original price as the regular one', () => {
    expect(product?.regularPrice).toEqual({ amount: 65, currency: 'EUR' });
    expect(product?.salePrice).toEqual({ amount: 49, currency: 'EUR' });
  });

  it('marks every field as the least trusted source', () => {
    for (const confidence of Object.values(product?.extractionMeta.fieldConfidence ?? {})) {
      expect(confidence).toBe(0.5);
    }
  });
});

describe('extraction options', () => {
  it('defaults scannedAt to now rather than leaving it empty', () => {
    const before = Date.now();
    const result = extractStructured(
      page('woo-product.html', 'https://ajil.example/product/walnut-500/')
    );
    const scannedAt = Date.parse(result.products[0]?.extractionMeta.scannedAt ?? '');

    expect(scannedAt).toBeGreaterThanOrEqual(before);
    expect(scannedAt).toBeLessThanOrEqual(Date.now());
  });

  it('never generates SKUs, which is the export step’s job', () => {
    const result = scan('woo-category.html', 'https://ajil.example/product-category/nuts/');
    for (const product of result.products) {
      expect(product.sku).toBeUndefined();
    }
  });
});
