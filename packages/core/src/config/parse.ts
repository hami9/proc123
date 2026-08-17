/**
 * Reading, checking and defaulting a config.
 *
 * Every default here is the one CLAUDE.md §9 gives, and two of them are
 * load-bearing rather than arbitrary:
 *
 * - `contentMode: 'structured-only'` — §8 says this default must not change. It
 *   is what keeps a user out of a duplicate-content problem they did not know
 *   they were opting into.
 * - `politeness` on, at 800ms — §10 says politeness stays on by default, and it
 *   is about not degrading the store being read.
 *
 * Unknown keys are reported rather than ignored. A typo in a hand-written
 * config that silently does nothing is worse than one that says so.
 */

import type { ContentMode, CurrencyUnit, ProductKind } from '../model.js';
import {
  ALL_EXPORTERS,
  ALL_TARGET_FIELDS,
  type ExporterName,
  type PartialConfig,
  type Proc123Config,
} from './types.js';

/** CLAUDE.md §9's example, which is also the sensible default. */
export const DEFAULT_CONFIG: Proc123Config = {
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
  maxPages: 20,
  contentMode: 'structured-only',
  currency: { code: 'IRR', displayUnit: 'toman' },
  politeness: { delayMsBetweenRequests: 800, maxConcurrent: 2 },
  exporter: 'woocommerce-csv',
  aiProvider: { name: 'gemini', model: 'gemini-2.5-flash', enabled: false },
};

const KINDS: readonly ProductKind[] = ['simple', 'variable', 'variation'];
const CONTENT_MODES: readonly ContentMode[] = ['structured-only', 'reference', 'rewrite'];
const UNITS: readonly CurrencyUnit[] = ['toman', 'rial'];

const TOP_LEVEL_KEYS = new Set<string>([
  'targetFields',
  'productTypes',
  'categoryFilter',
  'maxPages',
  'contentMode',
  'currency',
  'politeness',
  'exporter',
  'aiProvider',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ConfigResult {
  config: Proc123Config;
  /** Everything wrong or surprising, in plain words. Never throws. */
  problems: string[];
}

function readStringList<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  label: string,
  problems: string[]
): T[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    problems.push(`${label} must be a list`);
    return undefined;
  }

  const kept: T[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && (allowed as readonly string[]).includes(entry)) {
      if (!kept.includes(entry as T)) kept.push(entry as T);
    } else {
      problems.push(`${label} does not know "${String(entry)}"; allowed: ${allowed.join(', ')}`);
    }
  }
  return kept;
}

function readNumber(
  raw: unknown,
  label: string,
  { min, max }: { min: number; max: number },
  problems: string[]
): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    problems.push(`${label} must be a number`);
    return undefined;
  }
  if (raw < min || raw > max) {
    problems.push(`${label} must be between ${String(min)} and ${String(max)}; using the default`);
    return undefined;
  }
  return raw;
}

/**
 * Fold a user's settings onto the defaults.
 *
 * Anything unusable is reported and the default is kept, rather than the whole
 * config being rejected — a scan should not fail because one number was typed
 * as a string.
 */
export function resolveConfig(input: unknown): ConfigResult {
  const problems: string[] = [];
  const config: Proc123Config = {
    ...DEFAULT_CONFIG,
    targetFields: [...DEFAULT_CONFIG.targetFields],
    productTypes: [...DEFAULT_CONFIG.productTypes],
    currency: { ...DEFAULT_CONFIG.currency },
    politeness: { ...DEFAULT_CONFIG.politeness },
    aiProvider: { ...DEFAULT_CONFIG.aiProvider },
  };

  if (input === undefined || input === null) return { config, problems };
  if (!isRecord(input)) {
    return { config, problems: ['the config must be a JSON object; the defaults were used'] };
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      problems.push(`"${key}" is not a proc123 setting and was ignored`);
    }
  }

  const fields = readStringList(input['targetFields'], ALL_TARGET_FIELDS, 'targetFields', problems);
  if (fields !== undefined) {
    // A product with no name cannot be exported at all, so asking for one
    // without it is a request that cannot be honoured.
    if (fields.length > 0 && !fields.includes('name')) {
      problems.push('targetFields did not include "name"; it was added, since no row can omit it');
      fields.unshift('name');
    }
    if (fields.length > 0) config.targetFields = fields;
    else problems.push('targetFields was empty; the defaults were kept');
  }

  const kinds = readStringList(input['productTypes'], KINDS, 'productTypes', problems);
  if (kinds !== undefined && kinds.length > 0) config.productTypes = kinds;
  else if (kinds?.length === 0) problems.push('productTypes was empty; the defaults were kept');

  if (input['categoryFilter'] !== undefined) {
    if (typeof input['categoryFilter'] === 'string' && input['categoryFilter'].trim() !== '') {
      config.categoryFilter = input['categoryFilter'].trim();
    } else if (input['categoryFilter'] !== '') {
      problems.push('categoryFilter must be a string');
    }
  }

  const maxPages = readNumber(input['maxPages'], 'maxPages', { min: 1, max: 1000 }, problems);
  if (maxPages !== undefined) config.maxPages = Math.floor(maxPages);

  if (input['contentMode'] !== undefined) {
    if (CONTENT_MODES.includes(input['contentMode'] as ContentMode)) {
      config.contentMode = input['contentMode'] as ContentMode;
    } else {
      problems.push(`contentMode must be one of ${CONTENT_MODES.join(', ')}`);
    }
  }

  const currency = input['currency'];
  if (currency !== undefined) {
    if (!isRecord(currency)) problems.push('currency must be an object');
    else {
      if (typeof currency['code'] === 'string' && currency['code'].trim() !== '') {
        config.currency.code = currency['code'].trim().toUpperCase();
      }
      if (currency['displayUnit'] !== undefined) {
        if (UNITS.includes(currency['displayUnit'] as CurrencyUnit)) {
          config.currency.displayUnit = currency['displayUnit'] as CurrencyUnit;
        } else {
          problems.push(`currency.displayUnit must be ${UNITS.join(' or ')}`);
        }
      }
    }
  }

  const politeness = input['politeness'];
  if (politeness !== undefined) {
    if (!isRecord(politeness)) problems.push('politeness must be an object');
    else {
      // No upper bound worth enforcing on the delay — slower is always allowed.
      // The floor is 0 rather than something larger because a companion run
      // against a store you own is a legitimate reason to turn it off.
      const delay = readNumber(
        politeness['delayMsBetweenRequests'],
        'politeness.delayMsBetweenRequests',
        { min: 0, max: 600_000 },
        problems
      );
      if (delay !== undefined) config.politeness.delayMsBetweenRequests = Math.floor(delay);

      const concurrent = readNumber(
        politeness['maxConcurrent'],
        'politeness.maxConcurrent',
        { min: 1, max: 8 },
        problems
      );
      if (concurrent !== undefined) config.politeness.maxConcurrent = Math.floor(concurrent);
    }
  }

  if (typeof input['exporter'] === 'string' && input['exporter'].trim() !== '') {
    const exporter = input['exporter'].trim();
    // Checked by name rather than left free-form: a typo was previously
    // accepted silently and then fell through to WooCommerce at export time, so
    // a user asking for Shopify got a WooCommerce file and no explanation.
    if ((ALL_EXPORTERS as readonly string[]).includes(exporter)) {
      config.exporter = exporter as ExporterName;
    } else {
      problems.push(
        `exporter must be one of ${ALL_EXPORTERS.join(', ')}; "${exporter}" was ignored`
      );
    }
  }

  const ai = input['aiProvider'];
  if (ai !== undefined) {
    if (!isRecord(ai)) problems.push('aiProvider must be an object');
    else {
      if (typeof ai['name'] === 'string') config.aiProvider.name = ai['name'];
      if (typeof ai['model'] === 'string') config.aiProvider.model = ai['model'];
      if (typeof ai['enabled'] === 'boolean') config.aiProvider.enabled = ai['enabled'];
      // A key must never live in a config file that gets shared or committed
      // (CLAUDE.md §4). Say so rather than quietly dropping it.
      if ('apiKey' in ai || 'key' in ai) {
        problems.push(
          'aiProvider must not contain an API key — keys belong in extension settings, ' +
            'not in a file that gets shared or committed. It was ignored.'
        );
      }
    }
  }

  return { config, problems };
}

/** Read a `proc123.config.json`. Never throws; a broken file yields the defaults. */
export function parseConfig(json: string): ConfigResult {
  try {
    return resolveConfig(JSON.parse(json) as unknown);
  } catch (error) {
    return {
      config: resolveConfig(undefined).config,
      problems: [
        `the config is not valid JSON (${error instanceof Error ? error.message : String(error)}); ` +
          'the defaults were used',
      ],
    };
  }
}

/** Write a config out for a person to read and edit. */
export function serializeConfig(config: Proc123Config): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Layer one set of settings over another, for "site overrides global". */
export function mergeConfig(base: Proc123Config, over: PartialConfig): Proc123Config {
  return {
    ...base,
    ...over,
    targetFields: over.targetFields ?? base.targetFields,
    productTypes: over.productTypes ?? base.productTypes,
    currency: { ...base.currency, ...over.currency },
    politeness: { ...base.politeness, ...over.politeness },
    aiProvider: { ...base.aiProvider, ...over.aiProvider },
  };
}
