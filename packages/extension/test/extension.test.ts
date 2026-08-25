/**
 * The extension's own logic, without a browser.
 *
 * What is worth testing here is the seams: the fetch client's shape, the
 * storage round trip a killed worker depends on, and the scan summary the popup
 * makes its toman/rial decision from.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CanonicalProduct,
  CrawlState,
  HttpClient,
  ImageAsset,
  ImageOriginKind,
} from '@proc123/core';
import { DEFAULT_CONFIG, createMemoryCrawlStore } from '@proc123/core';

import { isFirefox, permissions, storage } from '../src/browser.js';
import { createFetchClient } from '../src/http.js';
import { imageFilename, isPhotograph } from '../src/images.js';
import {
  isDownloadImagesRequest,
  isExportRequest,
  isInspectRequest,
  isLastResultRequest,
  isScanRequest,
  isScanStatusRequest,
} from '../src/messages.js';
import { countCurrencyUnits, crawlIdFor, runScan } from '../src/scan.js';
import { importSettings, loadSettings, saveSettings } from '../src/settings.js';
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
    expect(isScanStatusRequest({ kind: 'scan-status', url: 'https://x.example/' })).toBe(true);
    expect(
      isExportRequest({ kind: 'export', url: 'https://x.example/', displayUnit: 'toman' })
    ).toBe(true);
  });

  it('rejects anything else, including a plausible near-miss', () => {
    // A message from another extension, or an older build of this one.
    expect(isScanRequest({ kind: 'scan', url: 'https://x.example/' })).toBe(false);
    expect(isScanStatusRequest({ kind: 'scan-status' })).toBe(false);
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

describe('settings', () => {
  let fake: FakeChrome;
  beforeEach(() => {
    fake = installFakeChrome();
  });
  afterEach(() => {
    fake.restore();
  });

  it('starts from the defaults in CLAUDE.md §9', async () => {
    const config = await loadSettings();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips what the popup saved', async () => {
    await saveSettings({ ...DEFAULT_CONFIG, maxPages: 3, targetFields: ['name', 'images'] });

    const config = await loadSettings();
    expect(config.maxPages).toBe(3);
    expect(config.targetFields).toEqual(['name', 'images']);
  });

  it('stores settings as readable JSON, not an opaque blob', async () => {
    // A user who does open the file should recognise what they are looking at.
    await saveSettings(DEFAULT_CONFIG);
    expect(String(fake.store.get('proc123.config'))).toContain('"contentMode": "structured-only"');
  });

  it('falls back to the defaults rather than failing a scan on a broken value', async () => {
    fake.store.set('proc123.config', '{ not json');
    expect((await loadSettings()).maxPages).toBe(20);
  });

  it('imports a pasted config and reports what it could not use', async () => {
    const { config, problems } = await importSettings('{"maxPages": 5, "nonsense": true}');

    expect(config.maxPages).toBe(5);
    expect(problems.join(' ')).toContain('"nonsense" is not a proc123 setting');
    // And it was saved, so the next scan uses it.
    expect((await loadSettings()).maxPages).toBe(5);
  });
});

/**
 * The browser shim (Phase 10).
 *
 * One source tree has to work on Chrome and on Firefox, and this is the only
 * file that knows the difference. The tests that matter are the two failure
 * modes an eager binding would have: throwing on import where no extension API
 * exists, and capturing a global that is replaced afterwards.
 */
describe('the browser shim', () => {
  interface Globals {
    browser?: unknown;
    chrome?: unknown;
  }

  const globals = globalThis as Globals;
  let saved: { browser?: unknown; chrome?: unknown };

  beforeEach(() => {
    saved = { browser: globals.browser, chrome: globals.chrome };
  });

  afterEach(() => {
    if (saved.browser === undefined) delete globals.browser;
    else globals.browser = saved.browser;
    if (saved.chrome === undefined) delete globals.chrome;
    else globals.chrome = saved.chrome;
  });

  it('prefers Firefox’s promise-returning `browser` over its `chrome` alias', () => {
    globals.chrome = { storage: { local: 'the chrome alias' } };
    globals.browser = { storage: { local: 'the browser API' } };

    expect(storage.local).toBe('the browser API');
  });

  it('uses `chrome` when there is no `browser` — Chrome, Edge, Brave', () => {
    delete globals.browser;
    globals.chrome = { storage: { local: 'the chrome API' } };

    expect(storage.local).toBe('the chrome API');
  });

  it('resolves on use, so a global installed after import is still seen', () => {
    // An eager `const api = chrome` at module load would have captured the
    // first of these and never noticed the second.
    globals.chrome = { storage: { local: 'first' } };
    expect(storage.local).toBe('first');

    globals.chrome = { storage: { local: 'second' } };
    expect(storage.local).toBe('second');
  });

  it('explains itself rather than throwing a ReferenceError when there is no API', () => {
    delete globals.browser;
    delete globals.chrome;

    expect(() => storage.local).toThrow(/only runs inside a browser extension/);
  });

  it('knows which engine it is on', () => {
    delete globals.browser;
    globals.chrome = {};
    expect(isFirefox()).toBe(false);

    globals.browser = {};
    expect(isFirefox()).toBe(true);
  });

  /**
   * The Firefox scan bug, kept from coming back.
   *
   * `permissions.request` only works while the click's user gesture is live.
   * The popup used to await the tab and a `contains` check first, which spends
   * it, so Firefox rejected the request — and because that happened outside
   * the popup's try block, the scan died with no message and no re-enabled
   * buttons. Pressing Scan simply did nothing, on Firefox only, because Chrome
   * tolerates the same sequence.
   *
   * Ordering is enforced by `startScan` calling this before any await. What is
   * checkable here is the other half: a request that fails must read as "not
   * granted" so the scan continues on the open page, never as an exception
   * that stops it.
   */
  describe('requestOrigin', () => {
    it('reports a granted origin', async () => {
      globals.chrome = { permissions: { request: () => Promise.resolve(true) } };
      await expect(permissions.requestOrigin('https://shop.example/*')).resolves.toBe(true);
    });

    it('reports a declined origin without throwing', async () => {
      globals.chrome = { permissions: { request: () => Promise.resolve(false) } };
      await expect(permissions.requestOrigin('https://shop.example/*')).resolves.toBe(false);
    });

    it('treats a rejected request as declined — Firefox’s lost user gesture', async () => {
      globals.chrome = {
        permissions: {
          request: () =>
            Promise.reject(
              new Error('permissions.request may only be called from a user input handler')
            ),
        },
      };
      await expect(permissions.requestOrigin('https://shop.example/*')).resolves.toBe(false);
    });

    it('treats a synchronous throw as declined too', async () => {
      globals.chrome = {
        permissions: {
          request: () => {
            throw new Error('may only be called from a user input handler');
          },
        },
      };
      await expect(permissions.requestOrigin('https://shop.example/*')).resolves.toBe(false);
    });
  });
});

/* --------------------------------------------------------------- phase 14 */

describe('inspector message guards', () => {
  it('accepts the inspect and download messages the popup sends', () => {
    expect(isInspectRequest({ kind: 'inspect', tabId: 7 })).toBe(true);
    expect(
      isDownloadImagesRequest({
        kind: 'download-images',
        urls: ['https://shop.example/a.jpg'],
        pageUrl: 'https://shop.example/c',
      })
    ).toBe(true);
    // An empty selection is well-formed; the popup disables the button rather
    // than sending a malformed message.
    expect(
      isDownloadImagesRequest({ kind: 'download-images', urls: [], pageUrl: 'https://x.example/' })
    ).toBe(true);
  });

  it('rejects anything malformed', () => {
    expect(isInspectRequest({ kind: 'inspect' })).toBe(false);
    expect(isInspectRequest({ kind: 'inspect', tabId: '7' })).toBe(false);
    expect(isInspectRequest(null)).toBe(false);
    // A non-string in `urls` would reach `downloads.download` as a URL.
    expect(
      isDownloadImagesRequest({
        kind: 'download-images',
        urls: ['ok', 42],
        pageUrl: 'https://x.example/',
      })
    ).toBe(false);
    expect(isDownloadImagesRequest({ kind: 'download-images', urls: 'nope', pageUrl: 'x' })).toBe(
      false
    );
  });
});

describe('which images are offered', () => {
  const asset = (origins: ImageOriginKind[]): ImageAsset => ({
    url: 'https://shop.example/p.jpg',
    origins,
  });

  it('offers the photographs', () => {
    expect(isPhotograph(asset(['img']))).toBe(true);
    expect(isPhotograph(asset(['srcset']))).toBe(true);
    expect(isPhotograph(asset(['source']))).toBe(true);
    expect(isPhotograph(asset(['preload']))).toBe(true);
  });

  it('keeps favicons and social previews out of a select-all', () => {
    expect(isPhotograph(asset(['icon']))).toBe(false);
    expect(isPhotograph(asset(['meta']))).toBe(false);
    expect(isPhotograph(asset(['css-background']))).toBe(false);
  });

  it('offers a file that is also referenced as a photograph', () => {
    // A hero image is routinely both preloaded and named in og:image. It is
    // still a photograph.
    expect(isPhotograph(asset(['meta', 'img']))).toBe(true);
  });
});

describe('naming a downloaded image', () => {
  const PAGE = 'https://www.ajil.example/shop/nuts';

  it('keeps the name the shop gave it, under a folder named after the shop', () => {
    expect(imageFilename('https://cdn.ajil.example/img/walnut.jpg', PAGE)).toBe(
      'proc123-ajil.example/walnut.jpg'
    );
  });

  it('keeps a Persian filename readable rather than hashing it', () => {
    expect(imageFilename('https://cdn.ajil.example/img/%DA%AF%D8%B1%D8%AF%D9%88.jpg', PAGE)).toBe(
      'proc123-ajil.example/گردو.jpg'
    );
  });

  it('cannot be talked out of the downloads folder', () => {
    // Every one of these is a path escape if the name is used as given.
    const escapes = [
      'https://evil.example/..%2F..%2F..%2Fetc%2Fpasswd.jpg',
      'https://evil.example/%2E%2E%2F%2E%2E%2Fshell.jpg',
      'https://evil.example/....//....//x.jpg',
    ];
    for (const url of escapes) {
      const name = imageFilename(url, PAGE);
      expect(name.startsWith('proc123-ajil.example/')).toBe(true);
      expect(name).not.toContain('..');
      expect(name.split('/').length).toBe(2);
    }
  });

  it('never lets a malformed page URL become the folder', () => {
    const name = imageFilename('https://cdn.example/a.jpg', 'not a url');
    expect(name).toBe('proc123-images/a.jpg');
  });

  it('gives an extensionless image a unique name rather than a colliding one', () => {
    const first = imageFilename('https://cdn.example/photo/1234', PAGE);
    const second = imageFilename('https://cdn.example/photo/5678', PAGE);

    expect(first).not.toBe(second);
    expect(first.endsWith('.jpg')).toBe(true);
  });

  it('trims a very long name but keeps its extension', () => {
    const long = `https://cdn.example/${'walnut'.repeat(40)}.jpeg`;
    const name = imageFilename(long, PAGE).split('/')[1] ?? '';

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('.jpeg')).toBe(true);
  });
});
