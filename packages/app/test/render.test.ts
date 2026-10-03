/**
 * Whether the app may offer to render a page (phase 18).
 *
 * On Android the native side registers no render command at all, so saying
 * "opening the page in a browser…" there would be a promise the app cannot
 * keep. These pin the answer per host.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { canRender } from '../src/render.js';

const tauri = { core: { invoke: () => Promise.resolve(null) } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canRender', () => {
  it('is false without a native host, as in a plain browser', () => {
    vi.stubGlobal('__TAURI__', undefined);
    expect(canRender()).toBe(false);
  });

  it('is true on the desktop', () => {
    vi.stubGlobal('__TAURI__', tauri);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    });
    expect(canRender()).toBe(true);
  });

  it('is false on Android, where no second WebView can be opened', () => {
    vi.stubGlobal('__TAURI__', tauri);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
    });
    expect(canRender()).toBe(false);
  });
});
