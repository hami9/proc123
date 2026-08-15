/**
 * Deduplication and the crawl driver.
 *
 * The interesting cases are the ones that only appear across pages: the same
 * product on page 1 and page 2, a service worker dying halfway, and a site that
 * starts refusing partway through.
 */

import { describe, expect, it } from 'vitest';

import {
  type CanonicalProduct,
  type CrawlState,
  type HttpClient,
  ProductIndex,
  crawlCategory,
  createMemoryCrawlStore,
  dedupeProducts,
  productKey,
} from '@proc123/core';

const SCANNED_AT = '2026-08-15T09:00:00.000Z';
const NOW = (): string => SCANNED_AT;

function product(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    sourceUrl: 'https://shop.example/p/walnut',
    kind: 'simple',
    name: 'Walnut',
    categoryPath: [],
    images: [],
    attributes: [],
    extractionMeta: { layer: 'B', fieldConfidence: { name: 0.95 }, scannedAt: SCANNED_AT },
    ...overrides,
  };
}

describe('productKey', () => {
  it('ignores cosmetic URL differences', () => {
    expect(productKey(product({ sourceUrl: 'https://shop.example/p/walnut/' }))).toBe(
      productKey(product({ sourceUrl: 'https://shop.example/p/walnut?utm_source=x' }))
    );
  });

  it('keeps variations of one product apart', () => {
    // `flattenDraft` gives every variation its parent's URL on purpose, so the
    // URL alone would collapse a variable product into a single row.
    const small = product({
      kind: 'variation',
      attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
    });
    const large = product({
      kind: 'variation',
      attributes: [{ name: 'Size', values: ['L'], isVariationAxis: true }],
    });

    expect(productKey(small)).not.toBe(productKey(large));
    expect(productKey(small)).not.toBe(productKey(product()));
  });
});

describe('ProductIndex', () => {
  it('folds a second sighting into the first', () => {
    const index = new ProductIndex();
    index.add(product());
    index.add(product());

    const { products, duplicates } = index.result();
    expect(products).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it('keeps the order products were first seen in', () => {
    // A parent must stay immediately before its own variations, or the CSV
    // imports incompletely.
    const { products } = dedupeProducts([
      product({ name: 'A', sourceUrl: 'https://shop.example/p/a' }),
      product({ name: 'B', sourceUrl: 'https://shop.example/p/b' }),
      product({ name: 'A', sourceUrl: 'https://shop.example/p/a' }),
      product({ name: 'C', sourceUrl: 'https://shop.example/p/c' }),
    ]);

    expect(products.map((entry) => entry.name)).toEqual(['A', 'B', 'C']);
  });

  it('takes the better-known value when a later sighting knows more', () => {
    const listing = product({
      extractionMeta: { layer: 'B', fieldConfidence: { name: 0.5 }, scannedAt: SCANNED_AT },
      name: 'Walnut — Example Nuts',
    });
    const detail = product({
      name: 'Walnut',
      sku: 'W1',
      extractionMeta: {
        layer: 'B',
        fieldConfidence: { name: 0.95, sku: 0.95 },
        scannedAt: SCANNED_AT,
      },
    });

    const { products } = dedupeProducts([listing, detail]);
    expect(products[0]?.name).toBe('Walnut');
    expect(products[0]?.sku).toBe('W1');
  });

  it('does not let a weaker later sighting overwrite a stronger one', () => {
    const strong = product({
      name: 'Walnut',
      extractionMeta: { layer: 'A', fieldConfidence: { name: 1 }, scannedAt: SCANNED_AT },
    });
    const weak = product({
      name: 'Walnut | Buy online',
      extractionMeta: { layer: 'B', fieldConfidence: { name: 0.5 }, scannedAt: SCANNED_AT },
    });

    expect(dedupeProducts([strong, weak]).products[0]?.name).toBe('Walnut');
  });

  it('recognises one product reached at two URLs by its SKU', () => {
    const { products, duplicates } = dedupeProducts([
      product({ sku: 'W1', sourceUrl: 'https://shop.example/p/walnut' }),
      product({ sku: 'W1', sourceUrl: 'https://shop.example/shop/walnut-500g' }),
    ]);

    expect(products).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it('does not match two variations on an absent SKU', () => {
    const { products } = dedupeProducts([
      product({
        kind: 'variation',
        sourceUrl: 'https://shop.example/p/a',
        attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
      }),
      product({
        kind: 'variation',
        sourceUrl: 'https://shop.example/p/b',
        attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
      }),
    ]);

    expect(products).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/** A category of `count` pages, each carrying one product plus a rel=next link. */
function paginatedStore(count: number, overlap = false): HttpClient {
  return (request) => {
    const match = /page\/(\d+)/.exec(request.url);
    const page = match?.[1] === undefined ? 1 : Number(match[1]);

    return Promise.resolve({
      status: page > count ? 404 : 200,
      headers: { 'content-type': 'text/html' },
      body: pageHtml(page, count, overlap),
      url: request.url,
    });
  };
}

function pageHtml(page: number, count: number, overlap: boolean): string {
  const names =
    overlap && page > 1
      ? [`Product ${String(page - 1)}`, `Product ${String(page)}`]
      : [`Product ${String(page)}`];

  const blocks = names
    .map((name) => {
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name,
        url: `https://shop.example/p/${slug}`,
        offers: { '@type': 'Offer', price: '10.00', priceCurrency: 'EUR' },
      });
    })
    .map((json) => `<script type="application/ld+json">${json}</script>`)
    .join('');

  const next =
    page < count
      ? `<link rel="next" href="https://shop.example/c/nuts/page/${String(page + 1)}/">`
      : '';

  return `<html><head>${next}${blocks}</head><body><h1>Nuts</h1></body></html>`;
}

const START = 'https://shop.example/c/nuts/';

async function crawl(options: Parameters<typeof crawlCategory>[1] = {}) {
  const html = pageHtml(1, 3, false);
  return crawlCategory(
    { url: START, html },
    { scannedAt: SCANNED_AT, now: NOW, politeness: { delayMsBetweenRequests: 0 }, ...options }
  );
}

describe('crawlCategory', () => {
  it('follows pagination to the end of the category', async () => {
    const result = await crawl({ http: paginatedStore(3) });

    expect(result.pagesScanned).toBe(3);
    expect(result.products.map((entry) => entry.name)).toEqual([
      'Product 1',
      'Product 2',
      'Product 3',
    ]);
    expect(result.state.status).toBe('complete');
  });

  it('reads the first page from the HTML it was handed, not over the network', async () => {
    const seen: string[] = [];
    const http: HttpClient = (request) => {
      seen.push(request.url);
      return paginatedStore(2)(request);
    };

    await crawl({ http });
    // Page 1 was already in hand — the browser had it open.
    expect(seen).toEqual(['https://shop.example/c/nuts/page/2']);
  });

  it('deduplicates products that appear on two pages', async () => {
    const result = await crawl({ http: paginatedStore(3, true) });

    expect(result.duplicates).toBeGreaterThan(0);
    expect(result.products.map((entry) => entry.name)).toEqual([
      'Product 1',
      'Product 2',
      'Product 3',
    ]);
  });

  it('paces the whole crawl with one client, not one per page', async () => {
    const result = await crawl({
      http: paginatedStore(3),
      politeness: { delayMsBetweenRequests: 0, maxConcurrent: 1 },
    });
    // Two fetches for pages 2 and 3; page 1 came from the caller.
    expect(result.requests).toBe(2);
  });

  it('stops at the page budget and says so', async () => {
    const result = await crawl({ http: paginatedStore(10), maxPages: 3 });

    expect(result.pagesScanned).toBe(3);
    expect(result.state.status).toBe('budget-reached');
    expect(result.state.queue.length).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.code)).toContain('page-budget-reached');
  });

  it('says when pagination needs a real browser', async () => {
    const html = `<html><head></head><body>
      <div class="products infinite-scroll"></div>
    </body></html>`;
    const result = await crawlCategory(
      { url: START, html },
      { scannedAt: SCANNED_AT, now: NOW, http: paginatedStore(3) }
    );

    expect(result.state.status).toBe('needs-browser');
    const issue = result.issues.find((entry) => entry.code === 'pagination-needs-browser');
    expect(issue?.message).toContain('infinite scroll');
  });

  it('reads only the first page when given no HTTP client', async () => {
    const result = await crawl({});
    expect(result.pagesScanned).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toContain('no-http-client');
  });
});

describe('resuming a crawl', () => {
  it('persists after every page', async () => {
    const store = createMemoryCrawlStore();
    await crawl({ http: paginatedStore(3), store });

    // One save per page, plus the final one. A worker killed at any point has
    // a record no more than a page out of date.
    expect(store.saves).toBeGreaterThanOrEqual(3);
  });

  it('carries on from where a killed worker left off', async () => {
    const store = createMemoryCrawlStore();

    // First run stops after two pages, as if the budget were the worker's life.
    const first = await crawl({ http: paginatedStore(4), store, maxPages: 2 });
    expect(first.state.status).toBe('budget-reached');
    expect(first.products).toHaveLength(2);

    // Second run finds the record and continues rather than starting again.
    const second = await crawl({ http: paginatedStore(4), store, maxPages: 10 });

    expect(second.products.map((entry) => entry.name)).toEqual([
      'Product 1',
      'Product 2',
      'Product 3',
      'Product 4',
    ]);
    expect(second.state.status).toBe('complete');
  });

  it('does not re-read pages the first run already read', async () => {
    const store = createMemoryCrawlStore();
    await crawl({ http: paginatedStore(4), store, maxPages: 2 });

    const seen: string[] = [];
    const http: HttpClient = (request) => {
      seen.push(request.url);
      return paginatedStore(4)(request);
    };
    await crawl({ http, store, maxPages: 10 });

    expect(seen).toEqual([
      'https://shop.example/c/nuts/page/3',
      'https://shop.example/c/nuts/page/4',
    ]);
  });

  it('starts over when asked to', async () => {
    const store = createMemoryCrawlStore();
    await crawl({ http: paginatedStore(4), store, maxPages: 2 });

    const restarted = await crawl({ http: paginatedStore(4), store, maxPages: 10, restart: true });
    expect(restarted.state.visited[0]).toBe('https://shop.example/c/nuts');
    expect(restarted.products).toHaveLength(4);
  });

  it('refuses to resume a record it cannot be sure it understands', async () => {
    const store = createMemoryCrawlStore();
    await store.save({ version: 999, id: 'crawl-x', status: 'running' } as unknown as CrawlState);

    // A half-understood resume would silently skip pages the old record
    // claimed to have read.
    const result = await crawl({ http: paginatedStore(2), store, id: 'crawl-x' });
    expect(result.products).toHaveLength(2);
  });
});

describe('a site that starts refusing partway through', () => {
  it('stops the crawl and keeps what it already had', async () => {
    const http: HttpClient = (request) =>
      Promise.resolve(
        /page\/3/.test(request.url)
          ? { status: 429, headers: {}, body: 'slow down', url: request.url }
          : {
              status: 200,
              headers: { 'content-type': 'text/html' },
              body: pageHtml(2, 4, false),
              url: request.url,
            }
      );

    const store = createMemoryCrawlStore();
    const result = await crawl({ http, store });

    expect(result.state.status).toBe('blocked');
    // Everything read before the refusal is kept — it was legitimately read.
    expect(result.products.length).toBeGreaterThan(0);

    const blocked = result.issues.find((issue) => issue.code === 'site-blocked');
    expect(blocked?.kind).toBe('site-blocked');
    expect(blocked?.message).toMatch(/does not work around one/);
  });

  it('will not resume a blocked crawl', async () => {
    const store = createMemoryCrawlStore();
    const http: HttpClient = (request) =>
      Promise.resolve({ status: 429, headers: {}, body: '', url: request.url });

    const blocked = await crawl({ http, store, id: 'crawl-blocked' });
    expect(blocked.state.status).toBe('blocked');
    expect((await store.load('crawl-blocked'))?.status).toBe('blocked');

    // A second run starts fresh rather than picking a blocked crawl back up:
    // resuming it would be retrying past a block, which §2 forbids.
    const again = await crawl({ http: paginatedStore(2), store, id: 'crawl-blocked' });
    expect(again.state.status).toBe('complete');
    // It began at page 1 again rather than picking up the blocked queue.
    expect(again.state.visited[0]).toBe('https://shop.example/c/nuts');
    expect(again.products.map((entry) => entry.name)).toEqual(['Product 1', 'Product 2']);
  });
});
