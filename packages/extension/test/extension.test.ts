/**
 * The extension's own logic, without a browser.
 *
 * What is worth testing here is the seams: the fetch client's shape, the
 * storage round trip a killed worker depends on, and the scan summary the popup
 * makes its toman/rial decision from.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CanonicalProduct, CrawlState, HttpClient } from '@proc123/core';
import { createMemoryCrawlStore } from '@proc123/core';

import { createFetchClient } from '../src/http.js';
import { isExportRequest, isLastResultRequest, isScanRequest } from '../src/messages.js';
import { countCurrencyUnits, crawlIdFor, runScan } from '../src/scan.js';
import { createChromeCrawlStore, loadLastResult, saveLastResult } from '../src/storage.js';
import { type FakeChrome, installFakeChrome } from './fake-chrome.js';

const SCANNED_AT = '2026-08-16T09:00:00.000Z';
const NOW = (): string => SCANNED_AT;

function product(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    sourceUrl: 'https://ajil.example/p/walnut',
    kind: 'simple',
    name: 'گردو',
    categoryPath: [],
    images: [],
    attributes: [],
    extractionMeta: { layer: 'B', fieldConfidence: { name: 0.95 }, scannedAt: SCANNED_AT },
    ...overrides,
  };
}

describe('message guards', () => {
  it('accepts the messages the popup actually sends', () => {
    expect(
      isScanRequest({ kind: 'scan', tabId: 1, url: 'https://x.example/', canFetch: true })
    ).toBe(true);
    expect(isLastResultRequest({ kind: 'last-result' })).toBe(true);
    expect(
      isExportRequest({ kind: 'export', url: 'https://x.example/', displayUnit: 'toman' })
    ).toBe(true);
  });

  it('rejects anything else, including a plausible near-miss', () => {
    // A message from another extension, or an older build of this one.
    expect(isScanRequest({ kind: 'scan', url: 'https://x.example/' })).toBe(false);
    expect(isExportRequest({ kind: 'export', url: 'https://x.example/' })).toBe(false);
    // An unrecognised unit must not reach the exporter: it decides a 10x factor.
    expect(
      isExportRequest({ kind: 'export', url: 'https://x.example/', displayUnit: 'dollars' })
    ).toBe(false);
    expect(isScanRequest(null)).toBe(false);
    expect(isScanRequest('scan')).toBe(false);
  });
});

describe('countCurrencyUnits', () => {
  it('counts each price, regular and sale alike', () => {
    const counts = countCurrencyUnits([
      product({
        regularPrice: { amount: 100, currency: 'IRR', unit: 'toman' },
        salePrice: { amount: 90, currency: 'IRR', unit: 'toman' },
      }),
    ]);
    expect(counts).toEqual({ toman: 2 });
  });

  it('keeps an unstated IRR unit in its own bucket', () => {
    // This is the number the popup shows before asking. Folding it into
    // `toman` would be answering the question on the user's behalf.
    const counts = countCurrencyUnits([
      product({ regularPrice: { amount: 100, currency: 'IRR' } }),
      product({ regularPrice: { amount: 100, currency: 'IRR', unit: 'rial' } }),
    ]);
    expect(counts).toEqual({ unknown: 1, rial: 1 });
  });

  it('reports a non-Iranian currency by its code, and a missing one as unknown', () => {
    const counts = countCurrencyUnits([
      product({ regularPrice: { amount: 10, currency: 'EUR' } }),
      product({ regularPrice: { amount: 10, currency: '' } }),
    ]);
    expect(counts).toEqual({ EUR: 1, unknown: 1 });
  });

  it('counts nothing for a product with no price', () => {
    expect(countCurrencyUnits([product()])).toEqual({});
  });
});

describe('crawlIdFor', () => {
  it('gives the same page the same record, however it was linked to', () => {
    expect(crawlIdFor('https://ajil.example/c/nuts/')).toBe(
      crawlIdFor('https://ajil.example/c/nuts?utm_source=telegram')
    );
  });

  it('gives different categories different records', () => {
    expect(crawlIdFor('https://ajil.example/c/nuts')).not.toBe(
      crawlIdFor('https://ajil.example/c/spices')
    );
  });
});

describe('createFetchClient', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(response: Response, seen: Request[] = []): Request[] {
    globalThis.fetch = ((input: string, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return Promise.resolve(response);
    }) as typeof fetch;
    return seen;
  }

  it('lowercases the header names core reads by', async () => {
    stubFetch(
      new Response('{}', {
        status: 200,
        headers: { 'X-WP-TotalPages': '3', 'Content-Type': 'application/json' },
      })
    );

    const response = await createFetchClient()({ url: 'https://ajil.example/wp-json/' });

    // `headerNumber(response, 'x-wp-totalpages')` in core depends on this.
    expect(response.headers['x-wp-totalpages']).toBe('3');
    expect(response.status).toBe(200);
  });

  it('reports a refusal rather than throwing, so the block check can see it', async () => {
    stubFetch(new Response('slow down', { status: 429 }));

    const response = await createFetchClient()({ url: 'https://ajil.example/wp-json/' });

    // core's polite client is what turns this into a stopped scan; the client
    // must hand it over intact rather than treat it as a failure of its own.
    expect(response.status).toBe(429);
    expect(response.body).toBe('slow down');
  });

  it('sends the session cookies, so prices match what the user sees', async () => {
    const seen = stubFetch(new Response('{}', { status: 200 }));
    await createFetchClient()({ url: 'https://ajil.example/wp-json/' });
    expect(seen[0]?.credentials).toBe('include');
  });
});

describe('the chrome.storage crawl store', () => {
  let fake: FakeChrome;
  beforeEach(() => {
    fake = installFakeChrome();
  });
  afterEach(() => {
    fake.restore();
  });

  const state = (overrides: Partial<CrawlState> = {}): CrawlState => ({
    version: 1,
    id: 'crawl-abc',
    startUrl: 'https://ajil.example/c/nuts',
    platform: 'woocommerce',
    layer: 'B',
    visited: ['https://ajil.example/c/nuts'],
    queue: ['https://ajil.example/c/nuts/page/2'],
    products: [product()],
    discoveredUrls: [],
    issues: [],
    pagesScanned: 1,
    requests: 0,
    duplicates: 0,
    status: 'running',
    updatedAt: SCANNED_AT,
    ...overrides,
  });

  it('round-trips a crawl record', async () => {
    const store = createChromeCrawlStore();
    await store.save(state());

    const loaded = await store.load('crawl-abc');
    expect(loaded?.queue).toEqual(['https://ajil.example/c/nuts/page/2']);
    expect(loaded?.products[0]?.name).toBe('گردو');
  });

  it('returns nothing for a crawl that was never saved', async () => {
    expect(await createChromeCrawlStore().load('crawl-missing')).toBeUndefined();
  });

  it('clears a record', async () => {
    const store = createChromeCrawlStore();
    await store.save(state());
    await store.clear('crawl-abc');
    expect(await store.load('crawl-abc')).toBeUndefined();
  });

  it('keeps records under a namespaced key, not a bare id', async () => {
    await createChromeCrawlStore().save(state());
    // Extensions share one storage area; a bare `crawl-abc` would be a
    // collision waiting to happen with anything else this project stores.
    expect([...fake.store.keys()]).toEqual(['proc123.crawl.crawl-abc']);
  });

  it('stores the last result separately from the crawl', async () => {
    await saveLastResult({ rowCount: 4 });
    expect(await loadLastResult<{ rowCount: number }>()).toEqual({ rowCount: 4 });
  });

  it('has no last result before the first scan', async () => {
    expect(await loadLastResult()).toBeUndefined();
  });
});

describe('runScan', () => {
  const html = `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'گردو',
      url: 'https://ajil.example/p/walnut',
      offers: { '@type': 'Offer', price: '150000', priceCurrency: 'IRR' },
    })}</script>
  </head><body><h1>آجیل</h1></body></html>`;

  const page = { url: 'https://ajil.example/c/nuts', html };

  it('summarises a scan for the popup', async () => {
    const summary = await runScan(
      { page, title: 'آجیل' },
      { store: createMemoryCrawlStore(), now: NOW }
    );

    expect(summary.rowCount).toBe(1);
    expect(summary.productCount).toBe(1);
    expect(summary.variationCount).toBe(0);
    expect(summary.layer).toBe('B');
    expect(summary.status).toBe('complete');
    expect(summary.resumed).toBe(false);
    expect(summary.finishedAt).toBe(SCANNED_AT);
  });

  it('reports the unstated unit so the popup can ask before exporting', async () => {
    const summary = await runScan(
      { page, title: 'آجیل' },
      { store: createMemoryCrawlStore(), now: NOW }
    );
    expect(summary.currencyUnits).toEqual({ unknown: 1 });
  });

  it('runs without a client, reading only the page it was given', async () => {
    const summary = await runScan(
      { page, title: 'آجیل' },
      { store: createMemoryCrawlStore(), now: NOW }
    );
    expect(summary.requests).toBe(0);
    expect(summary.pagesScanned).toBe(1);
  });

  it('knows when it picked up a saved scan rather than starting one', async () => {
    const store = createMemoryCrawlStore();
    const paged = {
      url: page.url,
      html: html.replace('<head>', '<head><link rel="next" href="/c/nuts/page/2">'),
    };

    const http: HttpClient = (request) =>
      Promise.resolve({
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: html,
        url: request.url,
      });

    // Stop after one page, the way a killed worker would.
    const first = await runScan(
      { page: paged, title: 'آجیل', maxPages: 1 },
      { http, store, now: NOW }
    );
    expect(first.resumed).toBe(false);
    expect(first.status).toBe('budget-reached');

    const second = await runScan({ page: paged, title: 'آجیل' }, { http, store, now: NOW });
    expect(second.resumed).toBe(true);
  });

  it('starts over when asked, rather than resuming', async () => {
    const store = createMemoryCrawlStore();
    await runScan({ page, title: 'آجیل' }, { store, now: NOW });

    const again = await runScan({ page, title: 'آجیل', restart: true }, { store, now: NOW });
    expect(again.resumed).toBe(false);
  });

  it('shows only a handful of issues, most severe first', async () => {
    const noisy = {
      url: 'https://outdoors.example/p/mug',
      html: '<html><body><h1>Mug</h1></body></html>',
    };

    const summary = await runScan(
      { page: noisy, title: 'Mug' },
      { store: createMemoryCrawlStore(), now: NOW }
    );

    expect(summary.rowCount).toBe(0);
    expect(summary.issues.length).toBeLessThanOrEqual(6);
    expect(summary.issues.map((issue) => issue.code)).toContain('no-structured-data');
  });
});
