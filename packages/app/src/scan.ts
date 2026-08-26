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
import { canRender, renderPage } from './render.js';

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

/** Which read answered. Reported because §18 asks for honest progress. */
export type ScanPath = 'static' | 'rendered';

export interface AppScanResult {
  summary: ScanSummary;
  products: CanonicalProduct[];
  path: ScanPath;
  /**
   * The pre-render HTML, kept when the rendered path was used.
   *
   * Phase 27's JS-dependency diff — what a crawler sees versus what a person
   * sees — needs both sides, and this is the only moment both exist. Throwing
   * it away here would mean fetching the page twice later.
   */
  staticHtml?: string;
  /**
   * How big each read was.
   *
   * The cheapest possible answer to "did rendering actually do anything?".
   * Equal sizes mean the WebView handed back the same shell the fetch got, so
   * a scan that found nothing found nothing for a reason that has nothing to
   * do with JavaScript. Without this the only way to tell those two apart is
   * to guess, which is how an afternoon disappears.
   */
  bytes: { static: number; rendered?: number };
}

export interface AppScanOptions {
  url: string;
  config?: Proc123Config;
  onProgress?: (progress: ScanProgress) => void;
  /** Told when the static read comes up empty and rendering starts. */
  onRenderFallback?: () => void;
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

  const deps = {
    http: raw,
    store,
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };

  const staticUrl = first.url ?? options.url;
  const summary = await runScan(
    { page: { url: staticUrl, html: first.body }, title: options.url, config },
    deps
  );

  // `runScan` reports counts; the rows themselves are in the crawl record it
  // just wrote. Reading them back rather than having `runScan` return them
  // keeps its shape the same for both surfaces.
  const state = await store.load(crawlIdFor(options.url));
  const products = state?.products ?? [];

  const staticBytes = first.body.length;

  if (products.length > 0 || !canRender()) {
    return { summary, products, path: 'static', bytes: { static: staticBytes } };
  }

  // Nothing found in the markup. That is the signature of a client-rendered
  // shop — the grid exists, but only after JavaScript has run — and it is the
  // failure the CLI has never been able to do anything about. Rendering is the
  // whole reason this app hosts a WebView (§15).
  //
  // The gate is deliberately "zero products" rather than "fewer than expected".
  // Rendering costs a second page load plus every subresource, which is real
  // load on somebody's server (§10), and a partial result is a real result. An
  // empty one is the only case where there is nothing to lose.
  options.onRenderFallback?.();

  let rendered;
  try {
    rendered = await renderPage(staticUrl);
  } catch {
    // A page that will not render is not a failed scan — the static answer,
    // empty as it is, is still the honest one. Saying "zero products" beats
    // replacing it with an error about a WebView the user never asked for.
    return { summary, products, path: 'static', bytes: { static: staticBytes } };
  }

  // A fresh store, because the crawl id is derived from the URL and reusing it
  // would resume the empty crawl that just finished rather than start over.
  const renderedStore = createMemoryStore();
  const renderedSummary = await runScan(
    { page: { url: rendered.url, html: rendered.html }, title: options.url, config },
    { ...deps, store: renderedStore }
  );
  const renderedState = await renderedStore.load(crawlIdFor(options.url));

  return {
    summary: renderedSummary,
    products: renderedState?.products ?? [],
    path: 'rendered',
    staticHtml: first.body,
    bytes: { static: staticBytes, rendered: rendered.html.length },
  };
}
