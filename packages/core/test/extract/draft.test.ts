import { describe, expect, it } from 'vitest';

import {
  type ProductDraft,
  createDraft,
  draftToProduct,
  flattenDraft,
  getField,
  mergeDraftInto,
  overwriteField,
  setField,
  setPricePair,
} from '@proc123/core';

import { SCANNED_AT } from './fixtures.js';

const OPTIONS = { layer: 'B', scannedAt: SCANNED_AT } as const;

function draftWithName(url = 'https://shop.example/p/1'): ProductDraft {
  const draft = createDraft(url);
  setField(draft, 'name', 'Walnut', 0.9, 'json-ld');
  return draft;
}

describe('setField', () => {
  it('keeps the more confident claim', () => {
    const draft = createDraft('https://shop.example/p/1');
    setField(draft, 'name', 'From OpenGraph', 0.5, 'opengraph');
    setField(draft, 'name', 'From JSON-LD', 0.95, 'json-ld');
    setField(draft, 'name', 'From Microdata', 0.7, 'microdata');

    expect(getField(draft, 'name')).toBe('From JSON-LD');
    expect(draft.values.name?.source).toBe('json-ld');
  });

  it('keeps the first claim on a tie, so priority order decides', () => {
    const draft = createDraft('https://shop.example/p/1');
    setField(draft, 'name', 'first', 0.7, 'json-ld');
    setField(draft, 'name', 'second', 0.7, 'microdata');

    expect(getField(draft, 'name')).toBe('first');
  });

  it('ignores absent, blank and empty values', () => {
    const draft = createDraft('https://shop.example/p/1');
    setField(draft, 'name', undefined, 0.9, 'json-ld');
    setField(draft, 'sku', '', 0.9, 'json-ld');
    setField(draft, 'sku', '   ', 0.9, 'json-ld');
    setField(draft, 'images', [], 0.9, 'json-ld');

    expect(draft.values).toEqual({});
  });

  it('keeps false and zero, which say something', () => {
    const draft = createDraft('https://shop.example/p/1');
    setField(draft, 'inStock', false, 0.9, 'json-ld');
    setField(draft, 'stockQuantity', 0, 0.9, 'json-ld');

    expect(getField(draft, 'inStock')).toBe(false);
    expect(getField(draft, 'stockQuantity')).toBe(0);
  });
});

describe('overwriteField', () => {
  it('replaces a value the confidence rule would have kept', () => {
    const draft = createDraft('https://shop.example/p/1');
    setField(
      draft,
      'attributes',
      [{ name: 'A', values: ['1'], isVariationAxis: false }],
      0.95,
      'json-ld'
    );
    overwriteField(
      draft,
      'attributes',
      [{ name: 'Size', values: ['S', 'L'], isVariationAxis: true }],
      0.5,
      'opengraph'
    );

    expect(getField(draft, 'attributes')).toEqual([
      { name: 'Size', values: ['S', 'L'], isVariationAxis: true },
    ]);
  });
});

describe('setPricePair', () => {
  const toman = (amount: number) => ({ amount, currency: 'IRR', unit: 'toman' as const });

  it('records a was/now pair', () => {
    const draft = createDraft('https://shop.example/p/1');
    setPricePair(draft, { regular: toman(150000), sale: toman(135000) }, 0.95, 'json-ld');

    expect(getField(draft, 'regularPrice')).toEqual(toman(150000));
    expect(getField(draft, 'salePrice')).toEqual(toman(135000));
  });

  it('drops a sale price that is not actually lower', () => {
    const draft = createDraft('https://shop.example/p/1');
    setPricePair(draft, { regular: toman(150000), sale: toman(150000) }, 0.95, 'json-ld');

    expect(getField(draft, 'regularPrice')).toEqual(toman(150000));
    expect(getField(draft, 'salePrice')).toBeUndefined();
  });

  it('promotes a lone sale price, since that is what the customer pays', () => {
    const draft = createDraft('https://shop.example/p/1');
    setPricePair(draft, { sale: toman(135000) }, 0.95, 'json-ld');

    expect(getField(draft, 'regularPrice')).toEqual(toman(135000));
    expect(getField(draft, 'salePrice')).toBeUndefined();
  });

  it("never pairs one source's regular price with another source's sale price", () => {
    const draft = createDraft('https://shop.example/p/1');
    // JSON-LD states only the current price.
    setPricePair(draft, { regular: toman(24) }, 0.95, 'json-ld');
    // OpenGraph states the pair, but less reliably.
    setPricePair(draft, { regular: toman(30), sale: toman(24) }, 0.5, 'opengraph');

    expect(getField(draft, 'regularPrice')).toEqual(toman(24));
    // The alternative — regular 24 and sale 24 — imports as a permanent 0% sale.
    expect(getField(draft, 'salePrice')).toBeUndefined();
  });

  it('lets a more confident pair replace a less confident single price', () => {
    const draft = createDraft('https://shop.example/p/1');
    setPricePair(draft, { regular: toman(24) }, 0.5, 'opengraph');
    setPricePair(draft, { regular: toman(30), sale: toman(24) }, 0.95, 'json-ld');

    expect(getField(draft, 'regularPrice')).toEqual(toman(30));
    expect(getField(draft, 'salePrice')).toEqual(toman(24));
  });

  it('does nothing when there is no price at all', () => {
    const draft = createDraft('https://shop.example/p/1');
    setPricePair(draft, {}, 0.95, 'json-ld');
    expect(draft.values).toEqual({});
  });
});

describe('mergeDraftInto', () => {
  it('keeps the more confident value per field', () => {
    const target = createDraft('https://shop.example/p/1');
    setField(target, 'name', 'JSON-LD name', 0.95, 'json-ld');
    setField(target, 'brand', 'JSON-LD brand', 0.95, 'json-ld');

    const incoming = createDraft('https://shop.example/p/1');
    setField(incoming, 'name', 'OG name', 0.5, 'opengraph');
    setField(incoming, 'shortDescription', 'OG excerpt', 0.5, 'opengraph');

    mergeDraftInto(target, incoming);

    expect(getField(target, 'name')).toBe('JSON-LD name');
    expect(getField(target, 'shortDescription')).toBe('OG excerpt');
  });

  it('carries prices across as a pair', () => {
    const target = createDraft('https://shop.example/p/1');
    const incoming = createDraft('https://shop.example/p/1');
    setPricePair(
      incoming,
      { regular: { amount: 30, currency: 'EUR' }, sale: { amount: 24, currency: 'EUR' } },
      0.5,
      'opengraph'
    );

    mergeDraftInto(target, incoming);

    expect(getField(target, 'regularPrice')).toEqual({ amount: 30, currency: 'EUR' });
    expect(getField(target, 'salePrice')).toEqual({ amount: 24, currency: 'EUR' });
  });

  it('does not try to reconcile two lists of variations', () => {
    const target = draftWithName();
    target.variants.push(draftWithName());

    const incoming = draftWithName();
    incoming.variants.push(draftWithName(), draftWithName());

    mergeDraftInto(target, incoming);
    expect(target.variants).toHaveLength(1);
  });
});

describe('draftToProduct', () => {
  it('refuses to build a nameless product', () => {
    const draft = createDraft('https://shop.example/p/1');
    setField(draft, 'sku', 'X1', 0.95, 'json-ld');

    expect(draftToProduct(draft, OPTIONS)).toBeUndefined();
  });

  it('records where each field came from as confidence', () => {
    const draft = draftWithName();
    setField(draft, 'sku', 'X1', 0.5, 'opengraph');

    const product = draftToProduct(draft, OPTIONS);
    expect(product?.extractionMeta).toEqual({
      layer: 'B',
      scannedAt: SCANNED_AT,
      fieldConfidence: { name: 0.9, sku: 0.5 },
    });
  });

  it('leaves absent optional fields absent rather than empty', () => {
    const product = draftToProduct(draftWithName(), OPTIONS);
    expect(product).not.toHaveProperty('sku');
    expect(product).not.toHaveProperty('regularPrice');
    expect(product?.categoryPath).toEqual([]);
    expect(product?.images).toEqual([]);
  });
});

describe('flattenDraft', () => {
  it('emits the parent immediately before its own variations', () => {
    const parent = draftWithName();
    setField(parent, 'sku', 'PARENT', 0.95, 'json-ld');

    for (const size of ['S', 'L']) {
      const variant = createDraft('https://variant.example/ignored');
      setField(variant, 'sku', `PARENT-${size}`, 0.95, 'json-ld');
      setField(
        variant,
        'attributes',
        [{ name: 'Size', values: [size], isVariationAxis: true }],
        0.95,
        'json-ld'
      );
      parent.variants.push(variant);
    }

    const rows = flattenDraft(parent, OPTIONS);

    expect(rows.map((row) => [row.kind, row.sku])).toEqual([
      ['variable', 'PARENT'],
      ['variation', 'PARENT-S'],
      ['variation', 'PARENT-L'],
    ]);
  });

  it('links every variation to the parent by SKU and by URL', () => {
    const parent = draftWithName('https://shop.example/p/tshirt');
    setField(parent, 'sku', 'PARENT', 0.95, 'json-ld');
    const variant = createDraft('https://shop.example/p/tshirt?variant=99');
    setField(variant, 'sku', 'PARENT-S', 0.95, 'json-ld');
    parent.variants.push(variant);

    const [parentRow, variantRow] = flattenDraft(parent, OPTIONS);

    expect(variantRow?.parentSku).toBe('PARENT');
    // assignSkus falls back to matching on sourceUrl when no SKU exists yet.
    expect(variantRow?.sourceUrl).toBe(parentRow?.sourceUrl);
  });

  it('gives a nameless variation the parent name rather than dropping it', () => {
    const parent = draftWithName();
    parent.variants.push(createDraft('https://shop.example/p/1'));

    const rows = flattenDraft(parent, OPTIONS);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.name).toBe('Walnut');
  });

  it('returns nothing at all for a nameless parent', () => {
    const parent = createDraft('https://shop.example/p/1');
    parent.variants.push(draftWithName());

    expect(flattenDraft(parent, OPTIONS)).toEqual([]);
  });
});
