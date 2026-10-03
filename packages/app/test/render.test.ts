/**
 * Whether the app may offer to render a page (phase 18).
 *
 * The native side reports whether it compiled the renderer in; Android builds
 * do not. Saying "opening the page in a browser…" on a build without it would
 * be a promise the app cannot keep.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { canRender, setRenderSupported } from '../src/render.js';

const tauri = { core: { invoke: () => Promise.resolve(null) } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canRender', () => {
  it('is false without a native host, as in a plain browser', () => {
    vi.stubGlobal('__TAURI__', undefined);
    setRenderSupported(true);
    expect(canRender()).toBe(false);
  });

  it('is true when the host compiled the renderer in', () => {
    vi.stubGlobal('__TAURI__', tauri);
    setRenderSupported(true);
    expect(canRender()).toBe(true);
  });

  it('is false when the host did not, as on Android', () => {
    vi.stubGlobal('__TAURI__', tauri);
    setRenderSupported(false);
    expect(canRender()).toBe(false);
  });
});
