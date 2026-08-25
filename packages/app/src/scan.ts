/**
 * Running a scan from the app.
 *
 * Almost nothing happens here, and that is the point. `runScan` in `core` owns
 * the pipeline — the layers, Layer D, filtering, the currency tally — and it
 * moved into `core` precisely so this file could be four calls rather than a
 * second copy of the extension's logic (CLAUDE.md §2).
 *
 * What the app supplies is the two things that genuinely differ: an
 * `HttpClient` that goes through Rust, and a crawl store that keeps state in
 * memory for the life of the window instead of in `chrome.storage`.
 */

import type {
  CanonicalProduct,
  CrawlState,
  CrawlStore,
  Proc123Config,
  ScanProgress,
  ScanSummary,
} from '@proc123/core';
import { DEFAULT_CONFIG, createPoliteClient, crawlIdFor, runScan } from '@proc123/core';

import { createTauriClient } from './http.js';

/**
 * Crawl state for the life of the window.
 *
 * The extension needs `chrome.storage` because MV3 kills its worker mid-scan
 * (§10) — a real constraint that does not exist here, where the process lives
 * as long as the window. Persisting to disk so a scan survives a *restart* is
 * worth having, but it is a feature rather than a workaround, and inventing a
 * file format for it now would be guessing at phase 17's needs.
 */
export function createMemoryStore(): CrawlStore {
  const saved = new Map<string, CrawlState>();
  return {
    load: (id) => Promise.resolve(saved.get(id)),
    save: (state) => {
      saved.set(state.id, state);
      return Promise.resolve();
    },
    clear: (id) => {
      saved.delete(id);
      return Promise.resolve();
    },
  };
}

export interface AppScanResult {
  summary: ScanSummary;
  products: CanonicalProduct[];
}

export interface AppScanOptions {
  url: string;
  config?: Proc123Config;
  onProgress?: (progress: ScanProgress) => void;
}

/**
 * Fetch the starting page, then hand the whole thing to `core`.
 *
 * The first page is fetched through the *paced* client rather than raw, so the
 * very first request a shop sees is already subject to §10. A native shell
 * removes the browser's own rate limiting, which makes that more important
 * rather than less — there is nothing else standing between this and somebody's
 * server.
 */
export async function scanCategory(options: AppScanOptions): Promise<AppScanResult> {
  const config = options.config ?? DEFAULT_CONFIG;
  const store = createMemoryStore();

  const raw = createTauriClient();

  // Two clients, and the split matters. `crawlCategory` wraps whatever it is
  // given in a polite client of its own, so it must receive the **raw** one —
  // handing it an already-paced client would wrap it twice and pace the whole
  // crawl at double the configured delay while double-counting its requests.
  //
  // This first fetch happens before `runScan` exists to do it, so it gets its
  // own paced wrapper. That is not belt-and-braces: it means the very first
  // request a shop ever sees from this app is already subject to §10, and it is
  // where a block is caught before a crawl starts.
  const polite = createPoliteClient(raw, {
    delayMsBetweenRequests: config.politeness.delayMsBetweenRequests,
    maxConcurrent: config.politeness.maxConcurrent,
  });

  // `polite.fetch` throws `SiteBlockedError` itself when the shop signals a
  // block, with `core`'s own wording — nothing here needs an opinion about what
  // a 403 means (§2).
  const first = await polite.fetch({ url: options.url });

  if (first.status >= 400) {
    throw new Error(`The page could not be read — the shop answered ${String(first.status)}.`);
  }

  const summary = await runScan(
    {
      page: { url: first.url ?? options.url, html: first.body },
      title: options.url,
      config,
    },
    {
      http: raw,
      store,
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    }
  );

  // `runScan` reports counts; the rows themselves are in the crawl record it
  // just wrote. Reading them back rather than having `runScan` return them
  // keeps its shape the same for both surfaces.
  const state = await store.load(crawlIdFor(options.url));

  return { summary, products: state?.products ?? [] };
}
