/**
 * Layer A — platform-native endpoints.
 *
 * When a store publishes its own catalogue as data, reading that is better than
 * reading its HTML by every measure: complete variations, real stock, the
 * store's own currency settings, and one request per hundred products instead of
 * one per page. This layer detects the platform and talks to that endpoint.
 *
 * It is also the first layer that touches the network, which makes CLAUDE.md §2
 * operative: when a site signals a block, the scan stops. See `blocking.ts`.
 */

import type { CanonicalProduct, ProductKind } from '../model.js';
import type { CheerioAPI } from '../extract/html.js';
import type { ExtractionIssue, ExtractionOptions, PageContext } from '../extract/types.js';
import type { HttpClient } from './http.js';

/**
 * Platforms worth telling apart.
 *
 * `unknown` is a real answer, not a failure: most of the web is a custom build,
 * and Layer B covers it.
 */
export type PlatformId =
  'woocommerce' | 'shopify' | 'magento' | 'nextjs' | 'nuxt' | 'prestashop' | 'opencart' | 'unknown';

export interface PlatformDetection {
  platform: PlatformId;
  /** 0..1. Several weak signals beat one strong one only when they agree. */
  confidence: number;
  /** Which markers fired, verbatim, for the "why did it pick that?" report. */
  signals: string[];
  /** False when the platform is recognised but Layer A has no adapter for it. */
  adapterAvailable: boolean;
}

/** CLAUDE.md §10 — politeness is on by default and is about the source server. */
export interface Politeness {
  /** Milliseconds between the *starts* of two requests. Default 800. */
  delayMsBetweenRequests?: number;
  /** Requests in flight at once. Default 2. */
  maxConcurrent?: number;
}

export interface ScanOptions extends ExtractionOptions {
  /**
   * Restrict the scan to one category, given as a slug, a term ID, or a
   * `parent > child` path. When absent it is read off the page URL.
   */
  categoryFilter?: string;
  /** Stop after this many pages of results. Default 20, matching CLAUDE.md §9. */
  maxPages?: number;
  politeness?: Politeness;
  /** Products per request. Clamped to whatever the platform allows. */
  perPage?: number;
  /**
   * Fetch each variable product's variations. One extra request per variable
   * product, so it is opt-out rather than free. Default on — a variable product
   * without variation rows imports as a product nobody can buy.
   */
  includeVariations?: boolean;
  /** Keep only these kinds. Default: everything the store returns. */
  productTypes?: ProductKind[];
}

/** What an adapter hands back. Products plus the reasons behind them. */
export interface AdapterReading {
  products: CanonicalProduct[];
  issues: ExtractionIssue[];
  /**
   * True when the adapter knows it did not return the whole category — a page
   * budget was hit, or a count cross-check failed. The caller decides whether
   * to fall through to Layer B.
   */
  incomplete: boolean;
  /** HTTP requests spent, for the scan report. */
  requests: number;
}

export interface AdapterContext {
  page: PageContext;
  /** The page already parsed, so adapters never re-parse it. */
  $: CheerioAPI;
  /** Pre-paced and block-guarded. Adapters must not fetch any other way. */
  http: HttpClient;
  options: ScanOptions;
}

/**
 * A platform adapter, as specified in CLAUDE.md §4.
 *
 * Two deliberate differences from the brief's sketch:
 *
 * `detect` is synchronous and returns the evidence rather than a bare boolean.
 * Detection reads the page that is already loaded, so it needs no request — and
 * a scan that cannot explain why it chose an adapter cannot be debugged.
 *
 * `fetchCategory` returns issues and an `incomplete` flag alongside the
 * products, because Shopify's endpoint can return a truthful-looking partial
 * answer (ROADMAP §6.14) and the caller has to be able to tell.
 */
export interface PlatformAdapter {
  readonly name: string;
  readonly platform: PlatformId;
  detect(page: PageContext, $: CheerioAPI): PlatformDetection | undefined;
  fetchCategory(context: AdapterContext): Promise<AdapterReading>;
}

/** The whole of Layer A for one page, plus what it fell back to. */
export interface ScanResult {
  layer: 'A' | 'B';
  platform: PlatformId;
  products: CanonicalProduct[];
  discoveredUrls: string[];
  issues: ExtractionIssue[];
  requests: number;
  incomplete: boolean;
  /** Everything detection considered, best first. */
  detections: PlatformDetection[];
}
