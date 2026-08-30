/**
 * The app's end of the bridge (CLAUDE.md §17).
 *
 * The property worth a test is not that a scan works — `core` has 800 of those
 * — but that an offered page is scanned **as given**. Re-fetching it would
 * discard the logged-in session that is the entire reason the extension handed
 * it over, and would do so silently: the scan would still succeed, against
 * whatever a logged-out visitor sees.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOffer } from '../src/bridge.js';

const OFFER_HTML = `<!doctype html>
<html lang="fa">
  <head>
    <title>Nuts</title>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
          {
            "@type": "Product",
            "name": "Walnut",
            "url": "https://shop.example/p/walnut",
            "offers": { "@type": "Offer", "price": "120000", "priceCurrency": "IRR" }
          }
        ]
      }
    </script>
  </head>
  <body>only reachable when signed in</body>
</html>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runOffer', () => {
  /**
   * No `__TAURI__` in Node, so `report` is a no-op and `invoke` is never
   * reached. That is the same guard every native call in this app uses, and it
   * is what lets the front end be opened in a plain browser during development.
   */
  it('scans the page it was handed without fetching anything', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('the bridge must not re-fetch an offered page');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const summary = await runOffer({
      scanId: 'scan-1',
      url: 'https://shop.example/c/nuts',
      title: 'Nuts',
      html: OFFER_HTML,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(summary).toBeDefined();
    expect(summary?.url).toBe('https://shop.example/c/nuts');
    expect(summary?.productCount).toBeGreaterThan(0);
  });

  /**
   * §7.8's question has to be askable about a bridged scan too. The unit tally
   * comes from `countCurrencyUnits` in `core` — the point here is that the
   * bridge path carries it through rather than dropping it, because a summary
   * without it is a summary the currency step cannot be built on.
   */
  it('carries the currency tally through, so the toman question stays askable', async () => {
    const summary = await runOffer({
      scanId: 'scan-2',
      url: 'https://shop.example/c/nuts',
      title: 'Nuts',
      html: OFFER_HTML,
    });

    expect(summary?.currencyUnits).toBeDefined();
    expect(Object.values(summary?.currencyUnits ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(
      0
    );
  });

  it('reports a failure rather than throwing at the listener', async () => {
    const summary = await runOffer({
      scanId: 'scan-3',
      url: 'not a url',
      title: '',
      html: '<html></html>',
    });

    // Either an empty scan or a caught failure — never an exception escaping
    // into the event handler, which would leave the extension polling forever.
    expect(summary === undefined || summary.productCount === 0).toBe(true);
  });
});
