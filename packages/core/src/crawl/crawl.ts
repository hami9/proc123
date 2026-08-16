/**
 * Walking a category.
 *
 * The first page decides how the rest are read. If the store's own API answered
 * it, that adapter already paged through the whole catalogue and there is
 * nothing left to walk. If the page's markup answered it, this driver follows
 * the pagination from page to page, reading each one the same way.
 *
 * Three rules from CLAUDE.md §10 shape it:
 *
 * - **State is persisted after every page.** An MV3 service worker is killed
 *   when idle, and a twenty-page scan at 800ms a page will outlive one. A
 *   restart must resume, not start again — starting again doubles the load on
 *   the store.
 * - **Products are deduplicated by URL and SKU.** Pagination and infinite
 *   scroll overlap constantly.
 * - **One pacer, one block latch, for the whole crawl.** Not per page.
 */

import type { CanonicalProduct } from '../model.js';
import { extractStructured } from '../extract/layer-b.js';
import { loadHtml } from '../extract/html.js';
import type { ExtractionIssue, PageContext } from '../extract/types.js';
import { isSiteBlockedError } from '../platform/blocking.js';
import { type PoliteClient, createPoliteClient } from '../platform/polite.js';
import { type ScanPageOptions, scanCategory } from '../platform/scan.js';
import { shortHash } from '../sha256.js';
import { canonicalizeUrl } from '../url.js';
import { ProductIndex } from './dedupe.js';
import { detectPagination } from './pagination.js';
import { type CrawlState, type CrawlStore, createCrawlState, isResumable } from './state.js';

/** CLAUDE.md §9's example config. */
const DEFAULT_MAX_PAGES = 20;

export interface CrawlOptions extends ScanPageOptions {
  /** Where to persist progress. Without one the crawl runs but cannot resume. */
  store?: CrawlStore;
  /**
   * Identifies the crawl. Defaults to a hash of the start URL, so re-running
   * the same scan finds its own record without the caller tracking an id.
   */
  id?: string;
  /** Start over even if a record exists. */
  restart?: boolean;
  /** Injected in tests so timestamps do not depend on the clock. */
  now?: () => string;
}

export interface CrawlResult {
  products: CanonicalProduct[];
  issues: ExtractionIssue[];
  state: CrawlState;
  /** Sightings folded into an earlier one. */
  duplicates: number;
  pagesScanned: number;
  requests: number;
}

async function fetchPage(client: PoliteClient, url: string): Promise<PageContext | undefined> {
  const response = await client.fetch({ url, headers: { accept: 'text/html' } });
  if (response.status < 200 || response.status >= 300) return undefined;
  return { url: response.url ?? url, html: response.body };
}

/**
 * Read a category, following its pagination.
 *
 * `page` is the first page's HTML, which the caller already has — in the
 * extension it is the tab the user is looking at. Every page after it is
 * fetched through the same paced, block-checked client.
 */
export async function crawlCategory(
  page: PageContext,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? `crawl-${shortHash(canonicalizeUrl(page.url), 10)}`;
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const store = options.store;

  const client =
    options.client ??
    (options.http === undefined
      ? undefined
      : createPoliteClient(options.http, options.politeness ?? {}));

  const index = new ProductIndex();

  let state: CrawlState | undefined;
  if (store !== undefined && options.restart !== true) {
    const saved = await store.load(id);
    if (isResumable(saved)) {
      state = saved;
      index.addAll(saved.products);
    }
  }

  const persist = async (): Promise<void> => {
    if (state === undefined) return;
    const { products, duplicates } = index.result();
    state.products = products;
    state.duplicates = duplicates;
    state.requests = client?.requests ?? state.requests;
    state.updatedAt = now();
    await store?.save(state);
  };

  // ---- First page -------------------------------------------------------
  if (state === undefined) {
    const first = await runFirstPage(page, options, client);
    if (first.blocked !== undefined) {
      state = createCrawlState(id, page.url, first.platform, 'B', now());
      state.status = 'blocked';
      state.issues = [first.blocked];
      await persist();
      return finish(state, index, client);
    }

    state = createCrawlState(id, page.url, first.platform, first.layer, now());
    state.visited.push(canonicalizeUrl(page.url));
    state.pagesScanned = 1;
    state.issues.push(...first.issues);
    state.discoveredUrls.push(...first.discoveredUrls);
    index.addAll(first.products);

    if (first.layer === 'A') {
      // The adapter paged through the catalogue itself; there is nothing here
      // to walk. Its own budget is the only thing that can have cut it short.
      state.status = first.incomplete ? 'budget-reached' : 'complete';
      await persist();
      return finish(state, index, client);
    }

    const plan = detectPagination(loadHtml(page.html), page);
    if (plan.nextUrl !== undefined) {
      state.queue.push(plan.nextUrl);
    } else if (plan.strategy === 'load-more' || plan.strategy === 'infinite-scroll') {
      state.status = 'needs-browser';
      state.issues.push({
        severity: 'info',
        code: 'pagination-needs-browser',
        url: page.url,
        message:
          `This category continues with ${plan.strategy === 'load-more' ? 'a "load more" button' : 'infinite scroll'} ` +
          `and publishes no URL for the next page, so it has to be driven in a real browser. ` +
          `Only the products already on this page were read.`,
      });
    } else {
      state.status = 'complete';
    }

    await persist();
    if (state.queue.length === 0) return finish(state, index, client);
  }

  // ---- Following pages --------------------------------------------------
  if (client === undefined) {
    state.issues.push({
      severity: 'warning',
      kind: 'network',
      code: 'no-http-client',
      message:
        'This category has more pages, but no HTTP client was supplied, so only the ' +
        'first page was read.',
    });
    await persist();
    return finish(state, index, client);
  }

  while (state.queue.length > 0) {
    if (state.pagesScanned >= maxPages) {
      state.status = 'budget-reached';
      state.issues.push({
        severity: 'info',
        code: 'page-budget-reached',
        message:
          `Stopped after ${String(maxPages)} pages with ${String(state.queue.length)} still queued. ` +
          `Raise maxPages, or resume this scan to carry on from here.`,
      });
      await persist();
      break;
    }

    const url = state.queue.shift();
    if (url === undefined) break;
    if (state.visited.includes(url)) continue;

    let next: PageContext | undefined;
    try {
      next = await fetchPage(client, url);
    } catch (error) {
      if (!isSiteBlockedError(error)) throw error;

      // CLAUDE.md §2. Stop, record it, and leave the queue as it is — this
      // crawl is over, and resuming it would be pushing past a block.
      state.status = 'blocked';
      state.issues.push({
        severity: 'error',
        kind: 'site-blocked',
        code: 'site-blocked',
        url: error.url,
        message: error.message,
      });
      await persist();
      return finish(state, index, client);
    }

    state.visited.push(url);
    state.pagesScanned += 1;

    if (next === undefined) {
      state.issues.push({
        severity: 'warning',
        kind: 'network',
        code: 'page-unavailable',
        url,
        message: 'A page of this category could not be read, so the scan stopped there.',
      });
      state.status = 'complete';
      await persist();
      break;
    }

    const reading = extractStructured(next, options);
    index.addAll(reading.products);
    state.issues.push(...reading.issues);
    for (const discovered of reading.discoveredUrls) {
      if (!state.discoveredUrls.includes(discovered)) state.discoveredUrls.push(discovered);
    }

    const plan = detectPagination(loadHtml(next.html), next);
    if (
      plan.nextUrl !== undefined &&
      !state.visited.includes(plan.nextUrl) &&
      !state.queue.includes(plan.nextUrl)
    ) {
      state.queue.push(plan.nextUrl);
    }

    if (state.queue.length === 0) state.status = 'complete';
    await persist();
  }

  if (state.status === 'running') state.status = 'complete';
  await persist();
  return finish(state, index, client);
}

interface FirstPage {
  platform: CrawlState['platform'];
  layer: 'A' | 'B' | 'C';
  products: CanonicalProduct[];
  discoveredUrls: string[];
  issues: ExtractionIssue[];
  incomplete: boolean;
  blocked?: ExtractionIssue;
}

async function runFirstPage(
  page: PageContext,
  options: CrawlOptions,
  client: PoliteClient | undefined
): Promise<FirstPage> {
  const scan = await scanCategory(page, {
    ...options,
    ...(client === undefined ? {} : { client }),
  });

  const blocked = scan.issues.find((issue) => issue.code === 'site-blocked');

  return {
    platform: scan.platform,
    layer: scan.layer,
    products: scan.products,
    discoveredUrls: scan.discoveredUrls,
    issues: scan.issues,
    incomplete: scan.incomplete,
    ...(blocked === undefined ? {} : { blocked }),
  };
}

function finish(
  state: CrawlState,
  index: ProductIndex,
  client: PoliteClient | undefined
): CrawlResult {
  const { products, duplicates } = index.result();
  state.products = products;
  state.duplicates = duplicates;
  state.requests = client?.requests ?? state.requests;

  return {
    products,
    issues: state.issues,
    state,
    duplicates,
    pagesScanned: state.pagesScanned,
    requests: state.requests,
  };
}
