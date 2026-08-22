/**
 * The scan, with its dependencies handed in.
 *
 * Everything Chrome-specific stays in `background.ts`; this is the part that
 * can be tested without a browser, which is the part where the decisions are.
 */

import {
  type CanonicalProduct,
  type CrawlProgress,
  type CrawlStore,
  type ExtractionIssue,
  type HttpClient,
  type PageContext,
  type Money,
  type Proc123Config,
  applyConfig,
  canonicalizeUrl,
  configToCrawlOptions,
  crawlCategory,
  createProvider,
  enrichWithAI,
  isIranianCurrency,
  isResumable,
  shortHash,
} from '@proc123/core';

import type { SiteProfile } from '@proc123/profiles';

import type { ScanSummary } from './messages.js';

export interface ScanDeps {
  /** Absent when the user declined the host permission: first page only. */
  http?: HttpClient;
  store: CrawlStore;
  now?: () => string;
  /**
   * The user's own AI key, from `chrome.storage`. Absent means Layer D is off,
   * which is also the default. It is passed separately from the config because
   * it must never travel with something that gets serialised (CLAUDE.md §4).
   */
  apiKey?: string;
  /** Reported after every page, so the popup can show a scan advancing. */
  onProgress?: (progress: CrawlProgress) => void;
}

export interface ScanInput {
  page: PageContext;
  title: string;
  restart?: boolean;
  /** Overrides the config's own `maxPages`, for tests. */
  maxPages?: number;
  /** The user's settings. Defaults are used when absent. */
  config?: Proc123Config;
  profile?: SiteProfile;
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

/**
 * Run Layer D over the products that came from the page we still hold.
 *
 * **The scope limit worth being explicit about.** Layer D needs a page's markup
 * to trim a fragment from, and to check the answer against afterwards. The
 * crawl keeps products, not HTML — retaining every page's DOM across a
 * multi-page crawl would blow the service worker's memory budget for a layer
 * that is off by default. So the products this can help are the ones described
 * by the page in hand: a single product page, or the cards on the category page
 * that was scanned.
 *
 * Products discovered on *later* pages are left alone rather than sent a
 * fragment from the wrong page — which would be worse than not running, because
 * `verify.ts` would be checking answers against markup that never described
 * them. Filling those needs per-product fetching, which belongs with the
 * troubleshooting phase that already re-visits pages.
 */
async function enrichLayerD(
  products: readonly CanonicalProduct[],
  input: ScanInput,
  deps: ScanDeps
): Promise<{ products: CanonicalProduct[]; issues: ExtractionIssue[] }> {
  const config = input.config;
  if (config === undefined || !config.aiProvider.enabled || deps.http === undefined) {
    return { products: [...products], issues: [] };
  }

  const provider = createProvider({
    name: config.aiProvider.name,
    apiKey: deps.apiKey ?? '',
    model: config.aiProvider.model,
    client: deps.http,
  });

  if (provider === undefined) {
    return {
      products: [...products],
      issues: [
        {
          severity: 'warning',
          code: 'ai-not-configured',
          kind: 'ai-failed',
          source: 'ai',
          url: input.page.url,
          message:
            (deps.apiKey ?? '') === ''
              ? 'The AI fallback is switched on but no API key is set. Add your own key in settings.'
              : `"${config.aiProvider.name}" is not a provider this build knows.`,
        },
      ],
    };
  }

  const pageUrl = canonicalizeUrl(input.page.url);
  const onThisPage = products.filter((product) => canonicalizeUrl(product.sourceUrl) === pageUrl);
  if (onThisPage.length === 0) return { products: [...products], issues: [] };

  const result = await enrichWithAI(onThisPage, input.page, provider, config, {
    maxRequests: onThisPage.length,
  });

  // Splice the enriched copies back into the original order.
  const bySource = new Map<CanonicalProduct, CanonicalProduct>();
  onThisPage.forEach((original, index) => {
    const next = result.products[index];
    if (next !== undefined) bySource.set(original, next);
  });

  return {
    products: products.map((product) => bySource.get(product) ?? product),
    issues: result.issues,
  };
}

export async function runScan(input: ScanInput, deps: ScanDeps): Promise<ScanSummary> {
  const now = deps.now ?? ((): string => new Date().toISOString());

  // The crawl id is chosen here rather than derived inside `crawlCategory`, so
  // that "was this resumed?" can be answered by looking before the crawl runs
  // instead of inferred from its counters afterwards.
  const id = crawlIdFor(input.page.url);
  const existing = input.restart === true ? undefined : await deps.store.load(id);
  const resumed = isResumable(existing);

  // The config is the single source of the pipeline's options; nothing here
  // assembles its own (CLAUDE.md §9).
  const options = input.config === undefined ? {} : configToCrawlOptions(input.config);

  const crawl = await crawlCategory(input.page, {
    ...options,
    ...(deps.http === undefined ? {} : { http: deps.http }),
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    store: deps.store,
    id,
    ...(input.restart === true ? { restart: true } : {}),
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    ...(deps.onProgress === undefined ? {} : { onPage: deps.onProgress }),
    now,
  });

  // Layer D runs before filtering, so it can fill a field that filtering is
  // about to trim, and after the crawl, so it only ever sees what A/B/C failed
  // to find. See `enrichWithAI` — the gate, the trim and the verification all
  // live there; this is only the wiring.
  const enriched = await enrichLayerD(crawl.products, input, deps);

  // Filtering happens after the scan rather than during it: a Store API scan
  // has to fetch a variable product to know it is one, and its variations are
  // needed even when only `variable` was asked for.
  const filtered =
    input.config === undefined
      ? { products: enriched.products, issues: [] as ExtractionIssue[] }
      : applyConfig(enriched.products, input.config);

  const products = filtered.products;
  const variations = products.filter(isVariation).length;

  return {
    url: input.page.url,
    title: input.title,
    layer: crawl.state.layer,
    platform: crawl.state.platform,
    rowCount: products.length,
    productCount: products.length - variations,
    variationCount: variations,
    duplicates: crawl.duplicates,
    pagesScanned: crawl.pagesScanned,
    requests: crawl.requests,
    status: crawl.state.status,
    // More than a handful is a wall of text in a 360px popup; the full list
    // stays in the crawl record for the troubleshooting report (§11).
    issues: rank([...crawl.issues, ...enriched.issues, ...filtered.issues]).slice(0, 6),
    resumed,
    currencyUnits: countCurrencyUnits(products),
    finishedAt: now(),
  };
}
