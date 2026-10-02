/**
 * Scanning a page the extension handed over (CLAUDE.md §17).
 *
 * Two properties are asserted here and they are the two the bridge exists for.
 *
 * **The handed page is not re-fetched.** That is the entire trade. The HTML
 * came out of the user's own browser, in their own logged-in session; fetching
 * the same URL from the app would get whatever a stranger gets, which for a
 * shop behind a login is a sign-in form. A regression here would not fail
 * loudly — it would quietly turn the bridge into an expensive way to pass a URL.
 *
 * **The app does not need the extension.** §17's "both work alone" is a
 * property that rots in silence, so it is a test rather than a promise.
 *
 * The native host is stubbed, so nothing here opens a socket (§12).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scanHandedPage } from '../src/scan.js';

/**
 * A category page whose products are in JSON-LD, so Layer B answers.
 *
 * An `ItemList` rather than a bare array of `Product`s, because that is what a
 * category page actually carries — and because `core` folds several loose
 * `Product` nodes into one on the assumption they describe the same thing,
 * which is right for a product page and would make this fixture a lie.
 */
function categoryHtml(names: string[], next?: string): string {
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: names.map((name, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Product',
        name,
        url: `https://shop.example/product/${encodeURIComponent(name)}/`,
        offers: { '@type': 'Offer', price: String((index + 1) * 1000), priceCurrency: 'USD' },
      },
    })),
  };
  const link = next === undefined ? '' : `<link rel="next" href="${next}" />`;
  return `<html><head>${link}<script type="application/ld+json">${JSON.stringify(list)}</script></head><body></body></html>`;
}

/** Every URL the app actually fetched, in order. */
let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  (globalThis as Record<string, unknown>)['__TAURI__'] = {
    core: {
      invoke: (command: string, args?: Record<string, unknown>) => {
        if (command !== 'http_fetch') return Promise.resolve(null);
        const request = args?.['request'] as { url: string };
        fetched.push(request.url);
        return Promise.resolve({
          status: 200,
          headers: {},
          body: categoryHtml(['Fetched product']),
          url: request.url,
        });
      },
    },
  };
});

describe('a page handed over by the extension', () => {
  it('is scanned from the HTML given, without fetching it again', async () => {
    const result = await scanHandedPage({
      url: 'https://shop.example/product-category/nuts/',
      title: 'Nuts',
      html: categoryHtml(['Pistachio', 'Almond']),
    });

    expect(result.products.map((p) => p.name)).toEqual(['Pistachio', 'Almond']);

    // The one assertion this file exists for: the handed URL was never fetched.
    expect(fetched).not.toContain('https://shop.example/product-category/nuts/');
  });

  it('reports itself as rendered, because a real browser rendered it', async () => {
    const html = categoryHtml(['Pistachio']);
    const result = await scanHandedPage({
      url: 'https://shop.example/c/',
      title: 'c',
      html,
    });

    expect(result.path).toBe('rendered');
    expect(result.bytes.rendered).toBe(html.length);
  });

  it('counts the currency units, so §7.8 can still be asked here', async () => {
    const result = await scanHandedPage({
      url: 'https://shop.example/c/',
      title: 'c',
      html: categoryHtml(['Pistachio', 'Almond']),
    });

    // The handoff must not become a path that skips the toman/rial question.
    // The tally is what makes it askable, so its presence is the test.
    expect(Object.keys(result.summary.currencyUnits).length).toBeGreaterThan(0);
  });

  it('falls back to the URL when the page had no title', async () => {
    const result = await scanHandedPage({
      url: 'https://shop.example/c/',
      title: '',
      html: categoryHtml(['Pistachio']),
    });
    expect(result.summary.title).toBe('https://shop.example/c/');
  });

  it('reports progress as it goes, so a long crawl is not a silent spinner', async () => {
    const onProgress = vi.fn();
    await scanHandedPage({
      url: 'https://shop.example/c/',
      title: 'c',
      html: categoryHtml(['Pistachio']),
      onProgress,
    });
    expect(onProgress).toHaveBeenCalled();
  });
});

describe('the app with no extension installed', () => {
  /**
   * `bridgeInfo` and `onHandoff` are the only two places the app touches the
   * bridge, and both have to be ordinary no-ops when there is nothing there —
   * which is also the case when the bundle is opened in a plain browser.
   */
  it('reads no bridge and subscribes to nothing, without throwing', async () => {
    delete (globalThis as Record<string, unknown>)['__TAURI__'];
    const { bridgeInfo, onHandoff } = await import('../src/bridge.js');

    await expect(bridgeInfo()).resolves.toBeUndefined();

    const unsubscribe = await onHandoff(() => {
      throw new Error('nothing should ever arrive');
    });
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });

  it('survives a native host that refuses the bridge command', async () => {
    (globalThis as Record<string, unknown>)['__TAURI__'] = {
      core: {
        invoke: () => Promise.reject(new Error('no such command')),
      },
    };
    const { bridgeInfo } = await import('../src/bridge.js');
    await expect(bridgeInfo()).resolves.toBeUndefined();
  });
});
