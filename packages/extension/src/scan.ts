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
  canonicalizeUrl,
  crawlCategory,
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

export async function runScan(input: ScanInput, deps: ScanDeps): Promise<ScanSummary> {
  const now = deps.now ?? ((): string => new Date().toISOString());

  // The crawl id is chosen here rather than derived inside `crawlCategory`, so
  // that "was this resumed?" can be answered by looking before the crawl runs
  // instead of inferred from its counters afterwards.
  const id = `crawl-${shortHash(canonicalizeUrl(input.page.url), 10)}`;
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
    finishedAt: now(),
  };
}
