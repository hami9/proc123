/**
 * The pipeline entry point: Layer A, then Layer B.
 *
 * CLAUDE.md §4 — the first layer that returns complete Tier-1 data wins, and
 * which layer produced each field is recorded so the troubleshooting report can
 * explain the gaps.
 *
 * The one rule with no exception is §2. When a site signals a block, this
 * function stops: no more requests, no fallback that reads the same site by
 * another route, no retry. It returns what it knows and says the site blocks
 * automated reading. Falling through to Layer B on a block would be a
 * workaround wearing a layer's name, so it deliberately does not happen.
 */

import { extractStructured } from '../extract/layer-b.js';
import { loadHtml } from '../extract/html.js';
import type { ExtractionIssue, PageContext } from '../extract/types.js';
import { isSiteBlockedError } from './blocking.js';
import { detectPlatforms } from './detect.js';
import { embeddedStateAdapter } from './embedded.js';
import type { HttpClient } from './http.js';
import { createPoliteClient } from './polite.js';
import { shopifyAdapter } from './shopify.js';
import type { PlatformAdapter, PlatformDetection, ScanOptions, ScanResult } from './types.js';
import { wooCommerceAdapter } from './woocommerce.js';

/**
 * Ordered by how much the endpoint can be trusted, not by how common it is.
 * WooCommerce's Store API is documented and stable; Shopify's is neither.
 */
export const ADAPTERS: readonly PlatformAdapter[] = [
  wooCommerceAdapter,
  shopifyAdapter,
  embeddedStateAdapter,
];

export interface ScanPageOptions extends ScanOptions {
  /**
   * Supplied by the extension's background worker or by the companion. Without
   * one, Layer A is limited to the adapters that need no network — which is
   * embedded state — and everything else falls to Layer B.
   */
  http?: HttpClient;
  /** Override the adapter list, for tests and for a targeted re-scan. */
  adapters?: readonly PlatformAdapter[];
}

interface Candidate {
  adapter: PlatformAdapter;
  detection: PlatformDetection;
}

function candidates(
  page: PageContext,
  $: ReturnType<typeof loadHtml>,
  adapters: readonly PlatformAdapter[]
): Candidate[] {
  const found: Candidate[] = [];
  for (const adapter of adapters) {
    const detection = adapter.detect(page, $);
    if (detection !== undefined) found.push({ adapter, detection });
  }
  return found.sort((a, b) => b.detection.confidence - a.detection.confidence);
}

/**
 * Scan one category page.
 *
 * Layer A adapters are tried in detection order. The first that returns a
 * complete answer wins; one that returns an admittedly partial answer is
 * compared against Layer B and the fuller of the two is kept.
 */
export async function scanCategory(
  page: PageContext,
  options: ScanPageOptions = {}
): Promise<ScanResult> {
  const $ = loadHtml(page.html);
  const detections = detectPlatforms(page, $);
  const issues: ExtractionIssue[] = [];

  const adapters = options.adapters ?? ADAPTERS;
  const polite =
    options.http === undefined
      ? undefined
      : createPoliteClient(options.http, options.politeness ?? {});

  const fallback = (
    layerB: ReturnType<typeof extractStructured>,
    requests: number,
    incomplete: boolean
  ): ScanResult => ({
    layer: 'B',
    platform: detections[0]?.platform ?? 'unknown',
    products: layerB.products,
    discoveredUrls: layerB.discoveredUrls,
    issues: [...issues, ...layerB.issues],
    requests,
    incomplete,
    detections,
  });

  for (const { adapter, detection } of candidates(page, $, adapters)) {
    // An adapter that needs the network cannot run without a client, and the
    // embedded-state one needs no client at all.
    const http = polite?.fetch;
    if (http === undefined && adapter !== embeddedStateAdapter) continue;

    let reading;
    try {
      reading = await adapter.fetchCategory({
        page,
        $,
        http: http ?? notConfigured,
        options,
      });
    } catch (error) {
      if (!isSiteBlockedError(error)) throw error;

      // §2. Stop here. Not "try the next adapter", not "fall back to reading
      // the page another way" — the site said no, and that is the end of it.
      issues.push({
        severity: 'error',
        kind: 'site-blocked',
        code: 'site-blocked',
        source: 'platform-api',
        url: error.url,
        message: error.message,
      });

      return {
        layer: 'A',
        platform: detection.platform,
        products: [],
        discoveredUrls: [],
        issues,
        requests: polite?.requests ?? 0,
        incomplete: true,
        detections,
      };
    }

    issues.push(...reading.issues);
    if (reading.products.length === 0) continue;

    if (!reading.incomplete) {
      return {
        layer: 'A',
        platform: adapter.platform,
        products: reading.products,
        discoveredUrls: [],
        issues,
        requests: polite?.requests ?? 0,
        incomplete: false,
        detections,
      };
    }

    // The adapter says its answer is partial — ROADMAP §6.14's case. Read the
    // page too and keep whichever saw more, rather than shipping half a
    // catalogue because one endpoint was capped.
    const layerB = extractStructured(page, options);
    if (layerB.products.length > reading.products.length) {
      return fallback(layerB, polite?.requests ?? 0, false);
    }

    return {
      layer: 'A',
      platform: adapter.platform,
      products: reading.products,
      discoveredUrls: layerB.discoveredUrls,
      issues: [...issues, ...layerB.issues],
      requests: polite?.requests ?? 0,
      incomplete: true,
      detections,
    };
  }

  const recognised = detections.find((detection) => !detection.adapterAvailable);
  if (recognised !== undefined) {
    issues.push({
      severity: 'info',
      code: 'no-adapter-for-platform',
      message:
        `This is a ${recognised.platform} store. Layer A has no adapter for it yet, ` +
        `so the page's own markup was read instead.`,
    });
  }

  return fallback(extractStructured(page, options), polite?.requests ?? 0, false);
}

const notConfigured: HttpClient = () => {
  throw new Error('No HTTP client was supplied to this scan.');
};
