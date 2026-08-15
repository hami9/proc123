/**
 * The two things Layer A must get right before it is allowed near a network:
 * recognising that a site said no, and not hammering one that said yes.
 *
 * CLAUDE.md §2 and §10.
 */

import { describe, expect, it } from 'vitest';

import {
  type HttpResponse,
  createPoliteClient,
  detectBlock,
  detectPlatform,
  detectPlatforms,
  isSiteBlockedError,
  loadHtml,
} from '@proc123/core';

import { fakeClock, fixture, page } from './helpers.js';

function response(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"products":[]}',
    url: 'https://shop.example/wp-json/wc/store/v1/products',
    ...overrides,
  };
}

describe('detectBlock', () => {
  it('lets an ordinary response through', () => {
    expect(detectBlock(response())).toBeUndefined();
  });

  it('does not treat a missing endpoint as a block', () => {
    // A store with the Store API switched off answers 404. That is a normal
    // answer meaning "not available here", and the scan falls through.
    expect(detectBlock(response({ status: 404, body: '<html>Not found</html>' }))).toBeUndefined();
    expect(detectBlock(response({ status: 500, body: 'oops' }))).toBeUndefined();
  });

  it('recognises rate limiting', () => {
    const detection = detectBlock(response({ status: 429 }));
    expect(detection?.signal).toBe('rate-limited');
    expect(detection?.reason).toContain('shop.example');
  });

  it('recognises a flat refusal', () => {
    expect(detectBlock(response({ status: 403 }))?.signal).toBe('forbidden');
  });

  it('recognises a login wall', () => {
    expect(detectBlock(response({ status: 401 }))?.signal).toBe('login-required');
  });

  it('recognises a challenge served with a 200', () => {
    const detection = detectBlock(
      response({
        body: '<html><head><title>Just a moment...</title></head><body></body></html>',
        headers: { 'content-type': 'text/html' },
      })
    );
    expect(detection?.signal).toBe('captcha');
    expect(detection?.evidence).toContain('Cloudflare');
  });

  it('recognises a challenge from its header alone', () => {
    const detection = detectBlock(response({ headers: { 'cf-mitigated': 'challenge' } }));
    expect(detection?.signal).toBe('captcha');
  });

  it.each([
    ['/cdn-cgi/challenge-platform/h/b/orchestrate', 'Cloudflare challenge platform script'],
    ['<div class="g-recaptcha" data-sitekey="x">', 'reCAPTCHA widget'],
    ['<div id="px-captcha"></div>', 'PerimeterX challenge'],
    ['<script src="/_Incapsula_Resource?SWJIYLWA">', 'Imperva/Incapsula challenge'],
  ])('recognises %j', (body, evidence) => {
    expect(detectBlock(response({ body, status: 503 }))?.evidence).toBe(evidence);
  });

  it('does not mistake a product page that mentions a captcha for a challenge', () => {
    const body = `<html><body>${'x'.repeat(5000)}Our review form uses g-recaptcha.</body></html>`;
    expect(detectBlock(response({ body }))).toBeUndefined();
  });
});

describe('createPoliteClient', () => {
  it('paces request starts by the configured delay', async () => {
    const clock = fakeClock();
    const client = createPoliteClient(() => Promise.resolve(response()), {
      delayMsBetweenRequests: 800,
      maxConcurrent: 1,
      sleep: clock.sleep,
      now: clock.now,
    });

    await client.fetch({ url: 'https://shop.example/1' });
    await client.fetch({ url: 'https://shop.example/2' });
    await client.fetch({ url: 'https://shop.example/3' });

    expect(clock.waits).toEqual([800, 800]);
    expect(client.requests).toBe(3);
  });

  it('counts only the requests it actually sent', async () => {
    const clock = fakeClock();
    const client = createPoliteClient(() => Promise.resolve(response()), {
      delayMsBetweenRequests: 0,
      sleep: clock.sleep,
      now: clock.now,
    });
    await client.fetch({ url: 'https://shop.example/1' });
    expect(client.requests).toBe(1);
  });

  it('stops the whole scan the first time a site signals a block', async () => {
    const clock = fakeClock();
    let sent = 0;
    const client = createPoliteClient(
      () => {
        sent += 1;
        return Promise.resolve(response({ status: 429 }));
      },
      { delayMsBetweenRequests: 0, sleep: clock.sleep, now: clock.now }
    );

    await expect(client.fetch({ url: 'https://shop.example/1' })).rejects.toThrow(/rate limiting/);

    // The second call must not reach the network at all. Retrying past a block
    // is precisely what CLAUDE.md §2 forbids.
    await expect(client.fetch({ url: 'https://shop.example/2' })).rejects.toThrow(/rate limiting/);
    expect(sent).toBe(1);
    expect(client.requests).toBe(1);
  });

  it('says what it will not do in the error itself', async () => {
    const clock = fakeClock();
    const client = createPoliteClient(() => Promise.resolve(response({ status: 403 })), {
      delayMsBetweenRequests: 0,
      sleep: clock.sleep,
      now: clock.now,
    });

    const error = await client.fetch({ url: 'https://shop.example/1' }).catch((e: unknown) => e);
    expect(isSiteBlockedError(error)).toBe(true);
    expect(String(error)).toMatch(/does not work around one/);
    expect(client.blocked?.signal).toBe('forbidden');
  });

  it('never runs more than maxConcurrent requests at once', async () => {
    const clock = fakeClock();
    let inFlight = 0;
    let peak = 0;

    const client = createPoliteClient(
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return response();
      },
      { delayMsBetweenRequests: 0, maxConcurrent: 2, sleep: clock.sleep, now: clock.now }
    );

    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => client.fetch({ url: `https://shop.example/${String(n)}` }))
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('platform detection', () => {
  const detectFor = (name: string, url: string) => {
    const context = page(name, url);
    return detectPlatform(context, loadHtml(context.html));
  };

  it('recognises WooCommerce and says why', () => {
    const detection = detectFor('woo-store-api.html', 'https://ajil.example/shop/');
    expect(detection.platform).toBe('woocommerce');
    expect(detection.adapterAvailable).toBe(true);
    expect(detection.signals).toContain('body class woocommerce');
    expect(detection.signals).toContain('wc_add_to_cart_params');
  });

  it('recognises Shopify', () => {
    const detection = detectFor(
      'shopify-collection.html',
      'https://roastery.example/collections/nuts'
    );
    expect(detection.platform).toBe('shopify');
    expect(detection.confidence).toBeGreaterThan(0.9);
  });

  it('recognises Next.js', () => {
    const detection = detectFor(
      'nextjs-storefront.html',
      'https://headless.example/collections/nuts'
    );
    expect(detection.platform).toBe('nextjs');
    expect(detection.signals).toContain('__NEXT_DATA__ script');
  });

  it('returns unknown for a custom build rather than guessing', () => {
    const detection = detectFor('no-markup.html', 'https://outdoors.example/p/mug');
    expect(detection.platform).toBe('unknown');
    expect(detection.confidence).toBe(0);
  });

  it('reports a platform it has no adapter for, instead of staying silent', () => {
    const html = `<html><head><meta name="generator" content="Magento 2.4">
      <script type="text/x-magento-init">{}</script></head><body></body></html>`;
    const detection = detectPlatform({ url: 'https://m.example/', html }, loadHtml(html));

    expect(detection.platform).toBe('magento');
    expect(detection.adapterAvailable).toBe(false);
  });

  it('reports every platform a headless storefront matches', () => {
    const html = fixture('nextjs-storefront.html').replace(
      '<body>',
      '<body class="shopify-section"><script>Shopify.shop="x.myshopify.com"</script>'
    );
    const platforms = detectPlatforms({ url: 'https://h.example/', html }, loadHtml(html)).map(
      (detection) => detection.platform
    );

    expect(platforms).toContain('nextjs');
    expect(platforms).toContain('shopify');
  });
});
