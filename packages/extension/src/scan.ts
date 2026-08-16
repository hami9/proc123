/**
 * The scan, with its dependencies handed in.
 *
 * Everything Chrome-specific stays in `background.ts`; this is the part that
 * can be tested without a browser, which is the part where the decisions are.
 */

import {
  type CanonicalProduct,
  type CrawlStore,
  type ExtractionIssue,
  type HttpClient,
  type PageContext,
  type Money,
  canonicalizeUrl,
  crawlCategory,
  isIranianCurrency,
  isResumable,
  shortHash,
} from '@proc123/core';

import type { ScanSummary } from './messages.js';

export interface ScanDeps {
  /** Absent when the user declined the host permission: first page only. */
  http?: HttpClient;
  store: CrawlStore;
  now?: () => string;
}

export interface ScanInput {
  page: PageContext;
  title: string;
  restart?: boolean;
  maxPages?: number;
}

/** Errors first — the popup shows the top few and there is no room to scroll. */
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function rank(issues: readonly ExtractionIssue[]): ExtractionIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function isVariation(product: CanonicalProduct): boolean {
  return product.kind === 'variation';
}

/**
 * Tally how the prices are quoted, so the popup can have the toman/rial
 * conversation *before* a file is written rather than after.
 *
 * `unknown` is its own bucket on purpose: a price the page tagged `IRR` without
 * saying which unit is not a toman price, it is an unanswered question, and
 * answering it wrongly is a 10x error (CLAUDE.md §7.8).
 */
export function countCurrencyUnits(products: readonly CanonicalProduct[]): Record<string, number> {
  const counts: Record<string, number> = {};

  const tally = (money: Money | undefined): void => {
    if (money === undefined) return;
    const key = isIranianCurrency(money.currency)
      ? (money.unit ?? 'unknown')
      : money.currency === ''
        ? 'unknown'
        : money.currency;
    counts[key] = (counts[key] ?? 0) + 1;
  };

  for (const product of products) {
    tally(product.regularPrice);
    tally(product.salePrice);
  }
  return counts;
}

/** The crawl record for a page, so a later export can find the same scan. */
export function crawlIdFor(url: string): string {
  return `crawl-${shortHash(canonicalizeUrl(url), 10)}`;
}

export async function runScan(input: ScanInput, deps: ScanDeps): Promise<ScanSummary> {
  const now = deps.now ?? ((): string => new Date().toISOString());

  // The crawl id is chosen here rather than derived inside `crawlCategory`, so
  // that "was this resumed?" can be answered by looking before the crawl runs
  // instead of inferred from its counters afterwards.
  const id = crawlIdFor(input.page.url);
  const existing = input.restart === true ? undefined : await deps.store.load(id);
  const resumed = isResumable(existing);

  const crawl = await crawlCategory(input.page, {
    ...(deps.http === undefined ? {} : { http: deps.http }),
    store: deps.store,
    id,
    ...(input.restart === true ? { restart: true } : {}),
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    now,
  });

  const variations = crawl.products.filter(isVariation).length;

  return {
    url: input.page.url,
    title: input.title,
    layer: crawl.state.layer,
    platform: crawl.state.platform,
    rowCount: crawl.products.length,
    productCount: crawl.products.length - variations,
    variationCount: variations,
    duplicates: crawl.duplicates,
    pagesScanned: crawl.pagesScanned,
    requests: crawl.requests,
    status: crawl.state.status,
    // More than a handful is a wall of text in a 360px popup; the full list
    // stays in the crawl record for the troubleshooting report (§11).
    issues: rank(crawl.issues).slice(0, 6),
    resumed,
    currencyUnits: countCurrencyUnits(crawl.products),
    finishedAt: now(),
  };
}
