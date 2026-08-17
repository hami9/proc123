/**
 * Choosing an exporter by name.
 *
 * `proc123.config.json` has carried an `exporter` field since Phase 7 and it
 * only ever produced WooCommerce. The tests here are about the two ways that
 * could still go wrong now that the name selects something: a name that means
 * nothing, and a name that quietly means the wrong thing.
 */

import { describe, expect, it } from 'vitest';

import { ALL_EXPORTERS, resolveConfig } from '@proc123/core';
import {
  EXPORTER_EXTENSIONS,
  EXPORTER_LABELS,
  EXPORTER_MIME_TYPES,
  exportProducts,
  exportWarnings,
  isExporterName,
} from '@proc123/exporters';

import { makeProduct } from './helpers.js';

const products = [
  makeProduct({ regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' } }),
];

describe('exportProducts', () => {
  it('produces a WooCommerce file for woocommerce-csv', () => {
    const outcome = exportProducts(products, 'woocommerce-csv');

    expect(outcome.exporter).toBe('woocommerce-csv');
    expect(outcome.text).toContain('Regular price');
    expect(outcome.rowCount).toBe(1);
  });

  it('produces a Shopify file for shopify-csv', () => {
    const outcome = exportProducts(products, 'shopify-csv');

    expect(outcome.text).toContain('URL handle');
    expect(outcome.text).toContain('Compare-at price');
    // The two CSVs are not interchangeable, and this is the giveaway.
    expect(outcome.text).not.toContain('Regular price');
  });

  it('produces JSON for json', () => {
    const outcome = exportProducts(products, 'json');

    expect(JSON.parse(outcome.text)).toMatchObject({ format: 'proc123-products' });
  });

  it('reports warnings for the CSVs and none for JSON', () => {
    const unitless = [makeProduct({ regularPrice: { amount: 150_000, currency: 'IRR' } })];

    expect(exportWarnings(exportProducts(unitless, 'woocommerce-csv')).length).toBeGreaterThan(0);
    expect(exportWarnings(exportProducts(unitless, 'shopify-csv')).length).toBeGreaterThan(0);
    // Not "checked, nothing wrong" — JSON reshapes nothing, so it has nothing
    // to warn about, and it keeps the unknown unit unknown.
    expect(exportWarnings(exportProducts(unitless, 'json'))).toEqual([]);
  });

  it('has a label, an extension and a MIME type for every name', () => {
    for (const name of ALL_EXPORTERS) {
      expect(EXPORTER_LABELS[name]).toBeTruthy();
      expect(EXPORTER_EXTENSIONS[name]).toBeTruthy();
      expect(EXPORTER_MIME_TYPES[name]).toBeTruthy();
    }
    // JSON is not text/csv, which is what the popup hands the blob.
    expect(EXPORTER_MIME_TYPES.json).toContain('application/json');
    expect(EXPORTER_EXTENSIONS.json).toBe('json');
  });
});

describe('the exporter name in the config', () => {
  it('accepts every name the dispatcher knows', () => {
    for (const name of ALL_EXPORTERS) {
      const { config, problems } = resolveConfig({ exporter: name });
      expect(config.exporter).toBe(name);
      expect(problems).toEqual([]);
    }
  });

  it('reports a name it does not know instead of silently exporting WooCommerce', () => {
    const { config, problems } = resolveConfig({ exporter: 'shopify' });

    expect(config.exporter).toBe('woocommerce-csv');
    expect(problems.join(' ')).toContain('exporter must be one of');
  });

  it('agrees with isExporterName', () => {
    expect(isExporterName('shopify-csv')).toBe(true);
    expect(isExporterName('shopify')).toBe(false);
  });
});
