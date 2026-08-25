/**
 * The app's `HttpClient`.
 *
 * `core` never calls `fetch` — it takes one of these (`platform/http.ts`). The
 * extension fills that seam with the service worker's `fetch`, the companion
 * with Node's, and this one with a call into Rust.
 *
 * **Going through Rust is the entire point of the native shell** (CLAUDE.md
 * §15). A `fetch` from this WebView would be subject to the same cross-origin
 * rules a web page is, which is the one thing the app exists to escape; a
 * request issued by the native side is not.
 *
 * There is no pacing and no retry here, and both omissions are deliberate.
 * `createPoliteClient` in `core` owns §10's delay and concurrency and stops a
 * scan when a site signals a block (§2). A native shell removes the browser's
 * own rate limiting, which makes that *more* important rather than less — a
 * second copy of the pacing here would be invisible and wrong, and a retry
 * would push past exactly the block §2 says to respect.
 */

import type { HttpClient, HttpRequest, HttpResponse } from '@proc123/core';

/** The subset of Tauri's global this file needs. */
interface TauriGlobal {
  core?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
}

/** What `http_fetch` returns. Mirrors `FetchResponse` in `src-tauri/src/http.rs`. */
interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
}

/**
 * True when the app is running inside Tauri rather than in a plain browser.
 *
 * The same bundle is opened directly in a browser while working on the UI, and
 * there it genuinely cannot fetch. Answering that honestly is better than
 * failing at the first request with something that reads like a network error.
 */
export function hasNativeHost(): boolean {
  const tauri = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return typeof tauri?.core?.invoke === 'function';
}

export function createTauriClient(): HttpClient {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    const tauri = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
    const invoke = tauri?.core?.invoke;

    if (invoke === undefined) {
      throw new Error(
        'This build is running without its native host, so it cannot fetch. ' +
          'Open the app itself rather than the front end in a browser.'
      );
    }

    const native = await invoke<NativeResponse>('http_fetch', {
      request: {
        url: request.url,
        method: request.method ?? 'GET',
        headers: request.headers ?? {},
        body: request.body,
      },
    });

    // Rust already lowercased the header names, which is what `header()` in
    // `core` reads by. Passed through rather than re-normalised so there is one
    // place that rule is met.
    return {
      status: native.status,
      headers: native.headers,
      body: native.body,
      url: native.url,
    };
  };
}
