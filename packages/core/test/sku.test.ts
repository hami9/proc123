import { describe, expect, it } from 'vitest';

import { assignSkus, generateParentSku, generateVariationSku } from '@proc123/core';

import { makeProduct } from './factory.js';

describe('generateParentSku', () => {
  it('uses the documented shape', () => {
    expect(generateParentSku('https://shop.example/p/1')).toMatch(/^P123-[0-9a-z]{8}$/);
  });

  it('is deterministic across scans', () => {
    expect(generateParentSku('https://shop.example/p/1')).toBe(
      generateParentSku('https://shop.example/p/1')
    );
  });

  it('ignores tracking parameters, so a re-scan updates instead of duplicating', () => {
    // The same product reached from a campaign link must produce the same SKU.
    expect(generateParentSku('https://shop.example/p/1?utm_source=instagram')).toBe(
      generateParentSku('https://shop.example/p/1')
    );
    expect(generateParentSku('https://shop.example/p/1/#tab')).toBe(
      generateParentSku('https://shop.example/p/1')
    );
  });

  it('differs per product', () => {
    expect(generateParentSku('https://shop.example/p/1')).not.toBe(
      generateParentSku('https://shop.example/p/2')
    );
  });

  it('honours a custom prefix', () => {
    expect(generateParentSku('https://shop.example/p/1', { prefix: 'ACME' })).toMatch(/^ACME-/);
  });
});

describe('generateVariationSku', () => {
  it('appends a slug of the attribute values', () => {
    expect(generateVariationSku('P123-abcd1234', ['500 گرم'])).toBe('P123-abcd1234-500-گرم');
    expect(generateVariationSku('P123-abcd1234', ['Red', 'Large'])).toBe('P123-abcd1234-red-large');
  });

  it('is deterministic', () => {
    expect(generateVariationSku('P', ['Red'])).toBe(generateVariationSku('P', ['Red']));
  });

  it('can be forced to ASCII', () => {
    const sku = generateVariationSku('P123-abcd1234', ['500 گرم'], { ascii: true });
    expect(sku).toMatch(/^P123-abcd1234-[0-9a-z]{6}$/);
  });

  it('falls back to a hash when the values slugify to nothing', () => {
    expect(generateVariationSku('P123-abcd1234', ['!!!'])).toMatch(/^P123-abcd1234-[0-9a-z]{6}$/);
    expect(generateVariationSku('P123-abcd1234', [])).toMatch(/^P123-abcd1234-[0-9a-z]{6}$/);
  });

  it('truncates absurdly long values but keeps them unique', () => {
    const a = generateVariationSku('P', ['x'.repeat(200)]);
    const b = generateVariationSku('P', [`${'x'.repeat(199)}y`]);
    expect(a.length).toBeLessThanOrEqual(2 + 40);
    expect(a).not.toBe(b);
  });
});

describe('assignSkus', () => {
  it('leaves source SKUs alone and fills in the rest', () => {
    const { products, generated } = assignSkus([
      makeProduct({ sku: 'REAL-SKU-1' }),
      makeProduct({ sourceUrl: 'https://shop.example/p/2' }),
    ]);

    expect(products[0]?.sku).toBe('REAL-SKU-1');
    expect(products[1]?.sku).toMatch(/^P123-/);
    expect(generated).toBe(1);
  });

  it('links variations to the parent that shares their page', () => {
    const url = 'https://shop.example/p/nuts';
    const { products } = assignSkus([
      makeProduct({ sourceUrl: url, kind: 'variable', name: 'Nuts' }),
      makeProduct({
        sourceUrl: url,
        kind: 'variation',
        name: 'Nuts - 500g',
        attributes: [{ name: 'Weight', values: ['500 گرم'], isVariationAxis: true }],
      }),
    ]);

    const parent = products[0];
    const variation = products[1];
    expect(variation?.parentSku).toBe(parent?.sku);
    expect(variation?.sku).toBe(`${parent?.sku ?? ''}-500-گرم`);
  });

  it('respects an explicit parentSku', () => {
    const { products } = assignSkus([
      makeProduct({ sourceUrl: 'https://shop.example/a', kind: 'variable', sku: 'PARENT' }),
      makeProduct({
        sourceUrl: 'https://shop.example/elsewhere',
        kind: 'variation',
        parentSku: 'PARENT',
      }),
    ]);
    expect(products[1]?.parentSku).toBe('PARENT');
  });

  it('guarantees every row has a unique SKU', () => {
    const duplicates: string[] = [];
    const { products, deduplicated } = assignSkus(
      [
        makeProduct({ sku: 'DUP' }),
        makeProduct({ sku: 'DUP', sourceUrl: 'https://shop.example/p/2' }),
        makeProduct({ sku: 'DUP', sourceUrl: 'https://shop.example/p/3' }),
      ],
      { onDuplicate: ({ replacement }) => duplicates.push(replacement) }
    );

    expect(products.map((p) => p.sku)).toEqual(['DUP', 'DUP-2', 'DUP-3']);
    expect(deduplicated).toBe(2);
    expect(duplicates).toEqual(['DUP-2', 'DUP-3']);
  });

  it('disambiguates two variations that slugify to the same suffix', () => {
    const url = 'https://shop.example/p/shirt';
    const { products } = assignSkus([
      makeProduct({ sourceUrl: url, kind: 'variable' }),
      makeProduct({
        sourceUrl: url,
        kind: 'variation',
        attributes: [{ name: 'Size', values: ['Large'], isVariationAxis: true }],
      }),
      makeProduct({
        sourceUrl: url,
        kind: 'variation',
        attributes: [{ name: 'Size', values: ['LARGE'], isVariationAxis: true }],
      }),
    ]);

    const skus = products.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('treats blank SKUs as missing', () => {
    const { products, generated } = assignSkus([makeProduct({ sku: '   ' })]);
    expect(products[0]?.sku).toMatch(/^P123-/);
    expect(generated).toBe(1);
  });

  it('preserves input order', () => {
    const names = ['a', 'b', 'c'];
    const { products } = assignSkus(
      names.map((name, i) => makeProduct({ name, sourceUrl: `https://shop.example/p/${i}` }))
    );
    expect(products.map((p) => p.name)).toEqual(names);
  });

  it('is stable across a re-scan', () => {
    const input = [
      makeProduct({ sourceUrl: 'https://shop.example/p/1', kind: 'variable' }),
      makeProduct({
        sourceUrl: 'https://shop.example/p/1',
        kind: 'variation',
        attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
      }),
    ];
    expect(assignSkus(input).products.map((p) => p.sku)).toEqual(
      assignSkus(input).products.map((p) => p.sku)
    );
  });
});
