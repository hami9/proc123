/**
 * The config from CLAUDE.md §9, and what it does to a scan.
 *
 * The filtering half is where the correctness is: a filter that drops a
 * variable product but keeps its variations produces rows the target store
 * cannot import, and the user never asked for that.
 */

import { describe, expect, it } from 'vitest';

import {
  type CanonicalProduct,
  DEFAULT_CONFIG,
  type Proc123Config,
  applyConfig,
  applyTargetFields,
  configToScanOptions,
  matchesCategory,
  mergeConfig,
  parseConfig,
  resolveConfig,
  serializeConfig,
} from '@proc123/core';

const SCANNED_AT = '2026-08-16T09:00:00.000Z';

function product(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    sourceUrl: 'https://ajil.example/p/walnut',
    kind: 'simple',
    name: 'گردو',
    categoryPath: ['آجیل', 'گردو'],
    images: ['https://cdn.ajil.example/walnut.jpg'],
    attributes: [],
    regularPrice: { amount: 150000, currency: 'IRR', unit: 'toman' },
    inStock: true,
    weight: { value: 500, unit: 'g' },
    brand: 'آجیل نمونه',
    extractionMeta: {
      layer: 'B',
      fieldConfidence: { name: 0.95, weight: 0.95, brand: 0.95, images: 0.95 },
      scannedAt: SCANNED_AT,
    },
    ...overrides,
  };
}

const config = (over: Partial<Proc123Config> = {}): Proc123Config => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/**
 * SKU is *not* among §9's default `targetFields`, so the filtering tests below
 * ask for it explicitly — it is how they tell one product from another.
 */
const showingSku = (over: Partial<Proc123Config> = {}): Proc123Config =>
  config({ ...over, targetFields: [...DEFAULT_CONFIG.targetFields, 'sku'] });

describe('resolveConfig', () => {
  it('uses CLAUDE.md §9 defaults when given nothing', () => {
    const { config: resolved, problems } = resolveConfig(undefined);
    expect(problems).toEqual([]);
    expect(resolved.maxPages).toBe(20);
    expect(resolved.politeness).toEqual({ delayMsBetweenRequests: 800, maxConcurrent: 2 });
    expect(resolved.exporter).toBe('woocommerce-csv');
  });

  it('keeps structured-only as the content mode default', () => {
    // CLAUDE.md §8 is explicit that this default must not change: it is what
    // keeps a user out of a duplicate-content problem they did not opt into.
    expect(resolveConfig({}).config.contentMode).toBe('structured-only');
  });

  it('leaves the AI provider off, since Layer D costs per token', () => {
    expect(resolveConfig({}).config.aiProvider.enabled).toBe(false);
  });

  it('accepts the example config from the brief verbatim', () => {
    const { config: resolved, problems } = resolveConfig({
      targetFields: [
        'name',
        'regularPrice',
        'salePrice',
        'categories',
        'images',
        'attributes',
        'stock',
      ],
      productTypes: ['simple', 'variable'],
      categoryFilter: 'آجیل > گردو',
      maxPages: 20,
      contentMode: 'structured-only',
      currency: { code: 'IRR', displayUnit: 'toman' },
      politeness: { delayMsBetweenRequests: 800, maxConcurrent: 2 },
      exporter: 'woocommerce-csv',
      aiProvider: { name: 'gemini', model: 'gemini-2.5-flash', enabled: false },
    });

    expect(problems).toEqual([]);
    expect(resolved.categoryFilter).toBe('آجیل > گردو');
  });

  it('reports a typo instead of silently ignoring it', () => {
    const { problems } = resolveConfig({ maxPagess: 5 });
    expect(problems.join(' ')).toContain('"maxPagess" is not a proc123 setting');
  });

  it('keeps the default rather than failing on an unusable value', () => {
    const { config: resolved, problems } = resolveConfig({ maxPages: 'twenty' });
    expect(resolved.maxPages).toBe(20);
    expect(problems.join(' ')).toContain('maxPages must be a number');
  });

  it('refuses a value out of range and says the range', () => {
    const { config: resolved, problems } = resolveConfig({
      politeness: { maxConcurrent: 200 },
    });
    expect(resolved.politeness.maxConcurrent).toBe(2);
    expect(problems.join(' ')).toContain('between 1 and 8');
  });

  it('puts "name" back if the settings left it out', () => {
    const { config: resolved, problems } = resolveConfig({ targetFields: ['images', 'brand'] });
    expect(resolved.targetFields[0]).toBe('name');
    expect(problems.join(' ')).toContain('no row can omit it');
  });

  it('refuses to carry an API key in a config file', () => {
    // CLAUDE.md §4: the user supplies their own key via settings, and it must
    // never be committed or shared. A config file is exactly what gets shared.
    const { problems } = resolveConfig({
      aiProvider: { name: 'gemini', apiKey: 'AIza-secret' },
    });
    expect(problems.join(' ')).toContain('must not contain an API key');
  });

  it('does not put the key anywhere in the resolved config', () => {
    const { config: resolved } = resolveConfig({ aiProvider: { apiKey: 'AIza-secret' } });
    expect(serializeConfig(resolved)).not.toContain('AIza-secret');
  });
});

describe('parseConfig', () => {
  it('round-trips', () => {
    const { config: resolved } = parseConfig(serializeConfig(DEFAULT_CONFIG));
    expect(resolved).toEqual(DEFAULT_CONFIG);
  });

  it('falls back to the defaults on a broken file, and says so', () => {
    const { config: resolved, problems } = parseConfig('{ not json');
    expect(resolved.maxPages).toBe(20);
    expect(problems.join(' ')).toContain('not valid JSON');
  });
});

describe('mergeConfig', () => {
  it('layers a site override over the global settings', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      maxPages: 3,
      currency: { displayUnit: 'rial' },
    });
    expect(merged.maxPages).toBe(3);
    expect(merged.currency).toEqual({ code: 'IRR', displayUnit: 'rial' });
    expect(merged.politeness).toEqual(DEFAULT_CONFIG.politeness);
  });
});

describe('configToScanOptions', () => {
  it('is the one place settings become pipeline options', () => {
    const options = configToScanOptions(
      config({ maxPages: 5, currency: { code: 'EUR', displayUnit: 'rial' } })
    );
    expect(options.maxPages).toBe(5);
    expect(options.defaultCurrency).toBe('EUR');
    expect(options.defaultCurrencyUnit).toBe('rial');
    expect(options.politeness?.delayMsBetweenRequests).toBe(800);
  });
});

describe('applyTargetFields', () => {
  it('drops what was not asked for', () => {
    const trimmed = applyTargetFields(product(), ['name', 'regularPrice']);
    expect(trimmed.name).toBe('گردو');
    expect(trimmed.regularPrice).toBeDefined();
    expect(trimmed).not.toHaveProperty('weight');
    expect(trimmed).not.toHaveProperty('brand');
  });

  it('empties the always-present lists rather than removing them', () => {
    const trimmed = applyTargetFields(product(), ['name']);
    expect(trimmed.images).toEqual([]);
    expect(trimmed.categoryPath).toEqual([]);
    expect(trimmed.attributes).toEqual([]);
  });

  it('takes the confidence entry with the value', () => {
    // Otherwise the "why is this field empty?" report claims a field was
    // extracted when it was deliberately turned off.
    const trimmed = applyTargetFields(product(), ['name']);
    expect(trimmed.extractionMeta.fieldConfidence).toEqual({ name: 0.95 });
  });

  it('turns "stock" off as one thing, both properties together', () => {
    const kept = applyTargetFields(product({ stockQuantity: 4 }), ['name', 'stock']);
    expect(kept.inStock).toBe(true);
    expect(kept.stockQuantity).toBe(4);

    const dropped = applyTargetFields(product({ stockQuantity: 4 }), ['name']);
    expect(dropped).not.toHaveProperty('inStock');
    expect(dropped).not.toHaveProperty('stockQuantity');
  });

  it('does not touch the original', () => {
    const original = product();
    applyTargetFields(original, ['name']);
    expect(original.brand).toBe('آجیل نمونه');
  });
});

describe('matchesCategory', () => {
  const walnut = product({ categoryPath: ['آجیل', 'گردو'] });

  it('matches a full path', () => {
    expect(matchesCategory(walnut, 'آجیل > گردو')).toBe(true);
  });

  it('matches a parent, keeping everything under it', () => {
    expect(matchesCategory(walnut, 'آجیل')).toBe(true);
  });

  it('matches a leaf without having to type its ancestors', () => {
    expect(matchesCategory(walnut, 'گردو')).toBe(true);
  });

  it('does not match a sibling category', () => {
    expect(matchesCategory(walnut, 'آجیل > بادام')).toBe(false);
    expect(matchesCategory(walnut, 'ادویه')).toBe(false);
  });

  it('ignores spacing and Arabic/Persian letter differences', () => {
    expect(matchesCategory(walnut, '  آجیل>گردو ')).toBe(true);
  });
});

describe('applyConfig', () => {
  const parent = product({
    kind: 'variable',
    sku: 'AJ-PIS',
    name: 'پسته اکبری',
    sourceUrl: 'https://ajil.example/p/pistachio',
    categoryPath: ['آجیل', 'پسته'],
  });
  const variations = [
    product({
      kind: 'variation',
      sku: 'AJ-PIS-500',
      parentSku: 'AJ-PIS',
      sourceUrl: parent.sourceUrl,
    }),
    product({
      kind: 'variation',
      sku: 'AJ-PIS-1K',
      parentSku: 'AJ-PIS',
      sourceUrl: parent.sourceUrl,
    }),
  ];
  const simple = product({ sku: 'AJ-WAL', name: 'گردو' });

  const all = [simple, parent, ...variations];

  it('keeps everything by default', () => {
    expect(applyConfig(all, config()).products).toHaveLength(4);
  });

  it('leaves SKU out by default, because §9 does', () => {
    expect(applyConfig(all, config()).products[0]).not.toHaveProperty('sku');
  });

  it('takes a variable product’s variations with it when it is dropped', () => {
    // The trap: dropping the parent alone leaves rows whose Parent column
    // points at nothing, which the exporter then discards with a warning the
    // user did not cause.
    const result = applyConfig(all, showingSku({ productTypes: ['simple'] }));

    expect(result.products.map((entry) => entry.sku)).toEqual(['AJ-WAL']);
    expect(result.counts.byProductType).toBe(1);
    expect(result.counts.variations).toBe(2);
  });

  it('keeps a variable product’s variations even when "variation" is not asked for', () => {
    // A variable product without its variations imports as something nobody
    // can buy, so `productTypes: ['variable']` has to mean "and its rows".
    const result = applyConfig(all, showingSku({ productTypes: ['variable'] }));
    expect(result.products.map((entry) => entry.sku)).toEqual([
      'AJ-PIS',
      'AJ-PIS-500',
      'AJ-PIS-1K',
    ]);
  });

  it('filters by category and takes the variations along', () => {
    const result = applyConfig(all, showingSku({ categoryFilter: 'آجیل > گردو' }));
    expect(result.products.map((entry) => entry.sku)).toEqual(['AJ-WAL']);
    expect(result.counts.byCategory).toBe(1);
  });

  it('keeps the parent immediately before its own variations', () => {
    const result = applyConfig(all, config({ categoryFilter: 'آجیل' }));
    expect(result.products.map((entry) => entry.kind)).toEqual([
      'simple',
      'variable',
      'variation',
      'variation',
    ]);
  });

  it('links a variation to its parent by URL when it has no parent SKU yet', () => {
    // SKUs are assigned at export time, so mid-pipeline most variations have
    // none and the shared source URL is the only link there is.
    const unlinked = [
      product({ kind: 'variable', name: 'پسته', sourceUrl: 'https://ajil.example/p/pistachio' }),
      product({ kind: 'variation', sourceUrl: 'https://ajil.example/p/pistachio' }),
    ];
    const result = applyConfig(unlinked, config({ productTypes: ['variable'] }));
    expect(result.products).toHaveLength(2);
  });

  it('explains every product it left out', () => {
    const result = applyConfig(all, config({ productTypes: ['simple'] }));
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).toContain('filtered-by-product-type');
    expect(codes).toContain('filtered-variations');
    expect(result.issues.every((issue) => issue.severity === 'info')).toBe(true);
  });

  it('says which fields are empty because the settings turn them off', () => {
    const result = applyConfig([simple], config({ targetFields: ['name'] }));
    const issue = result.issues.find((entry) => entry.code === 'fields-turned-off');
    expect(issue?.message).toContain('brand');
    expect(issue?.message).toContain('weight');
  });

  it('says nothing about turned-off fields when there is nothing to export', () => {
    const result = applyConfig([], config({ targetFields: ['name'] }));
    expect(result.issues).toEqual([]);
  });
});
