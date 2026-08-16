/**
 * The config, translated into the options the pipeline already takes.
 *
 * One source of truth: the popup and `proc123.config.json` both produce a
 * `Proc123Config`, and everything downstream is derived from it here rather
 * than each caller assembling its own options and drifting.
 */

import type { CrawlOptions } from '../crawl/crawl.js';
import type { ScanPageOptions } from '../platform/scan.js';
import type { Proc123Config } from './types.js';

/**
 * Options for a single page scan.
 *
 * `defaultCurrencyUnit` is the one setting here that changes a *number* rather
 * than what gets read: it decides how an IRR price with no stated unit is
 * understood, which is a factor of ten (CLAUDE.md §7.8). It is passed on only
 * because the user chose it explicitly.
 */
export function configToScanOptions(config: Proc123Config): ScanPageOptions {
  return {
    maxPages: config.maxPages,
    politeness: {
      delayMsBetweenRequests: config.politeness.delayMsBetweenRequests,
      maxConcurrent: config.politeness.maxConcurrent,
    },
    defaultCurrency: config.currency.code,
    defaultCurrencyUnit: config.currency.displayUnit,
    ...(config.categoryFilter === undefined ? {} : { categoryFilter: config.categoryFilter }),
    // `productTypes` is applied to the *results* rather than passed to the
    // adapters: a Store API scan still has to fetch a variable product to know
    // it is one, and its variations are needed even when only `variable` was
    // asked for.
  };
}

export function configToCrawlOptions(config: Proc123Config): CrawlOptions {
  return configToScanOptions(config);
}
