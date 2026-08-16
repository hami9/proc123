/**
 * The extension's HTTP client.
 *
 * This runs in the **background service worker**, never in a content script.
 * CLAUDE.md §2: a content script on an HTTPS page cannot reach
 * `http://127.0.0.1` at all (mixed content), and cross-origin reads belong to
 * the worker regardless. `core` never calls `fetch` itself — it takes one of
 * these.
 *
 * There is no retry here on purpose. `createPoliteClient` in core paces the
 * requests and stops the scan when a site signals a block; adding a retry at
 * this level would quietly defeat that (CLAUDE.md §2).
 */

import type { HttpClient, HttpResponse } from '@proc123/core';

/** Long enough for a slow store, short enough that a scan cannot hang forever. */
const TIMEOUT_MS = 20_000;

function lowercaseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

export function createFetchClient(timeoutMs = TIMEOUT_MS): HttpClient {
  return async (request): Promise<HttpResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method ?? 'GET',
        headers: request.headers ?? {},
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: controller.signal,
        // The user is already signed in to this store in this browser; sending
        // their cookies is what makes prices and stock match what they see.
        credentials: 'include',
        redirect: 'follow',
      });

      return {
        status: response.status,
        headers: lowercaseHeaders(response.headers),
        body: await response.text(),
        url: response.url === '' ? request.url : response.url,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
