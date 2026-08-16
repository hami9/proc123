/**
 * Crawl state and the last result, in `chrome.storage.local`.
 *
 * CLAUDE.md §10 and ROADMAP §6.11: an MV3 service worker is killed when idle,
 * so a scan that takes more than a few seconds will outlive the worker running
 * it. Everything worth keeping goes here after every page.
 *
 * The popup is just as ephemeral — it is destroyed the moment it loses focus —
 * so the last summary is stored too. Without that, closing the popup during a
 * scan loses the answer even though the scan finished fine.
 */

import type { CrawlState, CrawlStore } from '@proc123/core';

const CRAWL_PREFIX = 'proc123.crawl.';
const LAST_RESULT_KEY = 'proc123.lastResult';

export function createChromeCrawlStore(): CrawlStore {
  return {
    async load(id) {
      const key = CRAWL_PREFIX + id;
      const stored = await chrome.storage.local.get(key);
      const raw = stored[key];
      return typeof raw === 'string' ? (JSON.parse(raw) as CrawlState) : undefined;
    },

    async save(state) {
      // Stored as a string rather than a live object: `chrome.storage` does its
      // own structured clone, and a JSON round trip is the same thing the
      // resume path will do, so a value that cannot survive it fails here
      // rather than silently later.
      await chrome.storage.local.set({ [CRAWL_PREFIX + state.id]: JSON.stringify(state) });
    },

    async clear(id) {
      await chrome.storage.local.remove(CRAWL_PREFIX + id);
    },
  };
}

export async function saveLastResult(summary: unknown): Promise<void> {
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: JSON.stringify(summary) });
}

export async function loadLastResult<T>(): Promise<T | undefined> {
  const stored = await chrome.storage.local.get(LAST_RESULT_KEY);
  const raw = stored[LAST_RESULT_KEY];
  return typeof raw === 'string' ? (JSON.parse(raw) as T) : undefined;
}
