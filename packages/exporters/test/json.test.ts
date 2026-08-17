/**
 * The generic JSON exporter.
 *
 * The CSVs answer "how does this shop want to be fed?". This one answers "what
 * did proc123 actually find?", which is a different job with a different rule:
 * it must not reshape anything. The tests below are mostly about what it
 * refuses to decide.
 */

import { describe, expect, it } from 'vitest';

import { type JsonExportEnvelope, exportJson } from '@proc123/exporters';

import { makeProduct } from './helpers.js';

const AT = '2026-08-16T09:00:00.000Z';

const parse = (json: string): JsonExportEnvelope => JSON.parse(json) as JsonExportEnvelope;

describe('exportJson', () => {
  it('wraps the products in an envelope a reader can version-check', () => {
    const { json } = exportJson([makeProduct()], {
      generatedAt: AT,
      scannedUrl: 'https://shop.example/c/nuts',
    });
    const envelope = parse(json);

    expect(envelope.format).toBe('proc123-products');
    expect(envelope.version).toBe(1);
    expect(envelope.generatedAt).toBe(AT);
    expect(envelope.scannedUrl).toBe('https://shop.example/c/nuts');
  });

  it('counts products and variations separately', () => {
    const envelope = parse(
      exportJson(
        [
          makeProduct({ sku: 'P-1', kind: 'variable' }),
          makeProduct({ kind: 'variation', parentSku: 'P-1' }),
          makeProduct({ kind: 'variation', parentSku: 'P-1' }),
        ],
        { generatedAt: AT }
      ).json
    );

    expect(envelope.counts).toEqual({ products: 1, variations: 2 });
  });

  it('keeps an unanswered currency unit unanswered', () => {
    // A CSV has to pick toman or rial. This does not, and the difference is
    // exactly what someone debugging a 10x error needs to see.
    const json = exportJson([makeProduct({ regularPrice: { amount: 150_000, currency: 'IRR' } })], {
      generatedAt: AT,
    }).json;
    const price = parse(json).products[0]?.regularPrice;

    expect(price).toEqual({ amount: 150_000, currency: 'IRR' });
    expect(price).not.toHaveProperty('unit');
  });

  it('carries the provenance the CSVs have no column for', () => {
    const json = exportJson(
      [
        makeProduct({
          extractionMeta: {
            layer: 'D',
            fieldConfidence: { name: 0.3 },
            scannedAt: AT,
          },
        }),
      ],
      { generatedAt: AT }
    ).json;

    // `ExportedProduct` is a union — the meta may have been left out — so the
    // narrowing here is the same one a real consumer has to do.
    const product = parse(json).products[0];
    const meta =
      product !== undefined && 'extractionMeta' in product ? product.extractionMeta : undefined;

    expect(meta?.layer).toBe('D');
    expect(meta?.fieldConfidence['name']).toBe(0.3);
  });

  it('can leave provenance out for a consumer that would choke on it', () => {
    const json = exportJson([makeProduct()], { generatedAt: AT, includeMeta: false }).json;

    expect(parse(json).products[0]).not.toHaveProperty('extractionMeta');
  });

  it('sorts keys, so two scans of the same shop diff cleanly', () => {
    // Insertion order is whichever layer filled each field first, which makes
    // the same catalogue produce two files that differ only in key order.
    const a = exportJson([makeProduct({ name: 'Walnut', brand: 'Ajil' })], {
      generatedAt: AT,
    }).json;
    const b = exportJson([makeProduct({ brand: 'Ajil', name: 'Walnut' })], {
      generatedAt: AT,
    }).json;

    expect(a).toBe(b);
    expect(a.indexOf('"brand"')).toBeLessThan(a.indexOf('"name"'));
  });

  it('drops undefined rather than writing a key with no value', () => {
    const json = exportJson([makeProduct()], { generatedAt: AT }).json;

    expect(json).not.toContain('undefined');
    expect(parse(json).products[0]).not.toHaveProperty('salePrice');
  });

  it('pretty-prints by default and can be told not to', () => {
    const pretty = exportJson([makeProduct()], { generatedAt: AT }).json;
    const compact = exportJson([makeProduct()], { generatedAt: AT, pretty: false }).json;

    expect(pretty).toContain('\n  ');
    expect(compact).not.toContain('\n  ');
    expect(parse(pretty)).toEqual(parse(compact));
  });

  it('ends with a newline, like every other file this writes', () => {
    expect(exportJson([], { generatedAt: AT }).json.endsWith('\n')).toBe(true);
  });

  it('handles an empty scan without inventing anything', () => {
    const result = exportJson([], { generatedAt: AT });

    expect(result.rowCount).toBe(0);
    expect(parse(result.json).products).toEqual([]);
  });
});
