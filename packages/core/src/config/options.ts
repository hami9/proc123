/**
 * The config, translated into the options the pipeline already takes.
 *
 * One source of truth: the popup and `proc123.config.json` both produce a
 * `Proc123Config`, and everything downstream is derived from it here rather
 * than each caller assembling its own options and drifting.
 */

import type { CrawlOptions } from '../crawl/crawl.js';
import type { ScanPageOptions } from '../platform/scan.js';
import type { CurrencyUnit } from '../model.js';
import type { Proc123Config } from './types.js';

/**
 * Options for a single page scan.
 *
 * **`currency.displayUnit` is deliberately not passed as `defaultCurrencyUnit`.**
 * It used to be, and that silently answered §7.8's question for every user:
 * `DEFAULT_CONFIG` sets `displayUnit: 'toman'`, so every IRR price whose page
 * never said toman or rial was stamped `toman` at extraction. The unit was then
 * "known", the surfaces had nothing to ask, and the confirmation step that
 * exists to stop a ten-times price error never appeared — on a rial shop, every
 * price exported ten times too high, with no warning anywhere.
 *
 * `displayUnit` is what the user wants prices *written in*. What the shop
 * *quoted* is a different fact, and only the page or the user can supply it.
 * Leaving it unset keeps it `unknown`, which is what makes the question askable
 * (`extract/types.ts` says the same, and always did). The exporter is where
 * `displayUnit` belongs, and it is already passed there.
 *
 * `quotedUnit` is the other fact, when a person has actually stated it — the
 * CLI's `--unit`, which is documented as "how IRR prices on the page are
 * quoted". It is a separate argument rather than a config field precisely so a
 * default can never fill it in.
 */
export function configToScanOptions(
  config: Proc123Config,
  quotedUnit?: CurrencyUnit
): ScanPageOptions {
  return {
    maxPages: config.maxPages,
    politeness: {
      delayMsBetweenRequests: config.politeness.delayMsBetweenRequests,
      maxConcurrent: config.politeness.maxConcurrent,
    },
    defaultCurrency: config.currency.code,
    ...(quotedUnit === undefined ? {} : { defaultCurrencyUnit: quotedUnit }),
    ...(config.categoryFilter === undefined ? {} : { categoryFilter: config.categoryFilter }),
    // `productTypes` is applied to the *results* rather than passed to the
    // adapters: a Store API scan still has to fetch a variable product to know
    // it is one, and its variations are needed even when only `variable` was
    // asked for.
  };
}

export function configToCrawlOptions(
  config: Proc123Config,
  quotedUnit?: CurrencyUnit
): CrawlOptions {
  return configToScanOptions(config, quotedUnit);
}
