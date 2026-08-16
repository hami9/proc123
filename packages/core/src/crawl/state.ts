/**
 * Crawl state that survives the process it started in.
 *
 * CLAUDE.md §10 and ROADMAP §6.11: an MV3 service worker is killed when idle,
 * which for a scan of twenty pages with an 800ms delay is a near certainty
 * rather than an edge case. State is persisted after **every** page, so a
 * restart resumes rather than starts again — starting again is not merely slow,
 * it doubles the load on the store being read.
 *
 * The state carries the products found so far, which makes it self-contained:
 * a resumed crawl needs nothing but its own record. `chrome.storage.local`
 * gives about 10MB (more with `unlimitedStorage`), which is a large catalogue's
 * worth of canonical products, but it is a bound and the caller should know it.
 */

import type { CanonicalProduct } from '../model.js';
import type { ExtractionIssue } from '../extract/types.js';
import type { PlatformId } from '../platform/types.js';

export type CrawlStatus =
  | 'running'
  /** Every page was read. */
  | 'complete'
  /** The site signalled a block; the scan stopped and will not resume. */
  | 'blocked'
  /** `maxPages` was reached with pages still to go. */
  | 'budget-reached'
  /** Pagination needs a live browser to drive it. */
  | 'needs-browser';

/** Bumped when the shape changes; an older record is discarded rather than misread. */
export const CRAWL_STATE_VERSION = 1;

export interface CrawlState {
  version: number;
  /** Identifies this crawl, so the right one is resumed. */
  id: string;
  startUrl: string;
  platform: PlatformId;
  /** Which layer the first page settled on; later pages use the same one. */
  layer: 'A' | 'B' | 'C';
  /** Canonicalized URLs already read, for loop protection and for resuming. */
  visited: string[];
  /** Pages still to read, in order. */
  queue: string[];
  products: CanonicalProduct[];
  /** Product URLs seen but not described, for a later pass. */
  discoveredUrls: string[];
  issues: ExtractionIssue[];
  pagesScanned: number;
  requests: number;
  duplicates: number;
  status: CrawlStatus;
  /** ISO 8601, refreshed on every save. */
  updatedAt: string;
}

/**
 * Where a crawl record lives. The extension backs this with `chrome.storage`,
 * the companion with a file, tests with a map.
 */
export interface CrawlStore {
  load(id: string): Promise<CrawlState | undefined>;
  save(state: CrawlState): Promise<void>;
  clear(id: string): Promise<void>;
}

export function createCrawlState(
  id: string,
  startUrl: string,
  platform: PlatformId,
  layer: 'A' | 'B' | 'C',
  now: string
): CrawlState {
  return {
    version: CRAWL_STATE_VERSION,
    id,
    startUrl,
    platform,
    layer,
    visited: [],
    queue: [],
    products: [],
    discoveredUrls: [],
    issues: [],
    pagesScanned: 0,
    requests: 0,
    duplicates: 0,
    status: 'running',
    updatedAt: now,
  };
}

/**
 * Read back a record, refusing anything this build cannot be sure it understands.
 *
 * A half-understood resume is worse than a fresh start: it would silently skip
 * the pages the old record claimed to have visited.
 */
export function isResumable(state: CrawlState | undefined): state is CrawlState {
  return (
    state !== undefined &&
    state.version === CRAWL_STATE_VERSION &&
    (state.status === 'running' || state.status === 'budget-reached')
  );
}

/** An in-memory store, for tests and for a companion run that does not outlive itself. */
export function createMemoryCrawlStore(): CrawlStore & { readonly saves: number } {
  const records = new Map<string, string>();
  let saves = 0;

  return {
    load(id) {
      const raw = records.get(id);
      return Promise.resolve(raw === undefined ? undefined : (JSON.parse(raw) as CrawlState));
    },
    save(state) {
      saves += 1;
      // Serialized on the way in, so a caller that keeps mutating its own copy
      // cannot corrupt what was persisted — which is exactly what a real
      // storage backend does.
      records.set(state.id, JSON.stringify(state));
      return Promise.resolve();
    },
    clear(id) {
      records.delete(id);
      return Promise.resolve();
    },
    get saves() {
      return saves;
    },
  };
}
