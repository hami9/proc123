import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@proc123/core';

import { setRenderSupported } from '../src/render.js';
import { scanCategory } from '../src/scan.js';

const HTML = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Almond',
  offers: { '@type': 'Offer', price: '12', priceCurrency: 'USD' },
})}</script>`;
const config = { ...DEFAULT_CONFIG, politeness: { delayMsBetweenRequests: 0, maxConcurrent: 1 } };

afterEach(() => {
  setRenderSupported(false);
  vi.unstubAllGlobals();
});

describe('redirected category scans', () => {
  it('returns the rows saved under the HTTP destination URL without rendering again', async () => {
    const invoke = vi.fn((command: string) => {
      if (command !== 'http_fetch') throw new Error('unexpected render');
      return Promise.resolve({
        status: 200,
        headers: {},
        body: HTML,
        url: 'https://shop.example/c/',
      });
    });
    vi.stubGlobal('__TAURI__', { core: { invoke } });
    setRenderSupported(true);
    const result = await scanCategory({ url: 'https://shop.example/c', config });
    expect(result.products.map((product) => product.name)).toEqual(['Almond']);
    expect(result.path).toBe('static');
    expect(invoke.mock.calls.every(([command]) => command === 'http_fetch')).toBe(true);
  });

  it('returns rows saved under a client-side redirect destination', async () => {
    vi.stubGlobal('__TAURI__', {
      core: {
        invoke: (command: string) => {
          if (command === 'rendered_html')
            return Promise.resolve({
              url: 'https://shop.example/collection/',
              result: JSON.stringify(HTML),
            });
          return Promise.resolve({
            status: 200,
            headers: {},
            body: '<html></html>',
            url: 'https://shop.example/c/',
          });
        },
      },
    });
    setRenderSupported(true);
    const result = await scanCategory({ url: 'https://shop.example/c', config });
    expect(result.products.map((product) => product.name)).toEqual(['Almond']);
    expect(result.path).toBe('rendered');
  });
});
