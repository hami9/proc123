/**
 * Choosing an exporter by name.
 *
 * `proc123.config.json` has carried an `exporter` field since Phase 7 and it
 * only ever produced WooCommerce, because it was the only one. Now that there
 * are three, the name has to actually select one — in one place, so the popup,
 * the companion and any future caller cannot disagree about what
 * `"shopify-csv"` means.
 *
 * The three results are deliberately not unified into one shape. A CSV export
 * has warnings and a row count; a JSON export has neither, because it reshapes
 * nothing and so has nothing to warn about. Flattening them would invent an
 * empty `warnings: []` that reads as "checked, nothing wrong" rather than "not
 * applicable".
 */

import { ALL_EXPORTERS, type CanonicalProduct, type ExporterName } from '@proc123/core';

import { exportJson, type JsonExportOptions, type JsonExportResult } from './json/exporter.js';
import { exportShopifyCsv } from './shopify/exporter.js';
import type { ShopifyCsvExportResult, ShopifyCsvOptions } from './shopify/types.js';
import { exportWooCommerceCsv } from './woocommerce/exporter.js';
import type { WooCsvExportResult, WooCsvOptions } from './woocommerce/types.js';

export type { ExporterName };

/** Re-exported so a caller needs only this module to build a picker. */
export const EXPORTER_NAMES = ALL_EXPORTERS;

/** What a user sees in a dropdown, and the file each one produces. */
export const EXPORTER_LABELS: Readonly<Record<ExporterName, string>> = {
  'woocommerce-csv': 'WooCommerce CSV',
  'shopify-csv': 'Shopify CSV',
  json: 'JSON (everything found)',
};

export const EXPORTER_EXTENSIONS: Readonly<Record<ExporterName, string>> = {
  'woocommerce-csv': 'csv',
  'shopify-csv': 'csv',
  json: 'json',
};

export const EXPORTER_MIME_TYPES: Readonly<Record<ExporterName, string>> = {
  'woocommerce-csv': 'text/csv;charset=utf-8',
  'shopify-csv': 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function isExporterName(value: string): value is ExporterName {
  return (EXPORTER_NAMES as readonly string[]).includes(value);
}

export interface ExportOptions {
  woocommerce?: WooCsvOptions;
  shopify?: ShopifyCsvOptions;
  json?: JsonExportOptions;
}

export type ExportOutcome =
  | { exporter: 'woocommerce-csv'; text: string; rowCount: number; result: WooCsvExportResult }
  | { exporter: 'shopify-csv'; text: string; rowCount: number; result: ShopifyCsvExportResult }
  | { exporter: 'json'; text: string; rowCount: number; result: JsonExportResult };

/**
 * Run the named exporter.
 *
 * `text` and `rowCount` are lifted out so a caller that only wants to write a
 * file does not have to know which of the three it asked for; `result` keeps
 * the exporter-specific detail for one that does.
 */
export function exportProducts(
  products: readonly CanonicalProduct[],
  exporter: ExporterName,
  options: ExportOptions = {}
): ExportOutcome {
  switch (exporter) {
    case 'shopify-csv': {
      const result = exportShopifyCsv(products, options.shopify ?? {});
      return { exporter, text: result.csv, rowCount: result.rowCount, result };
    }
    case 'json': {
      const result = exportJson(products, options.json ?? {});
      return { exporter, text: result.json, rowCount: result.rowCount, result };
    }
    case 'woocommerce-csv': {
      const result = exportWooCommerceCsv(products, options.woocommerce ?? {});
      return { exporter, text: result.csv, rowCount: result.rowCount, result };
    }
    default: {
      // Exhaustive: adding an ExporterName without a case fails to compile.
      const never: never = exporter;
      return never;
    }
  }
}

/** Warnings, for the two exporters that have any. */
export function exportWarnings(outcome: ExportOutcome): { code: string; message: string }[] {
  if (outcome.exporter === 'json') return [];
  return outcome.result.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
  }));
}
