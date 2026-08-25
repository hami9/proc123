/**
 * The companion's `HttpClient`.
 *
 * `core` never calls `fetch` (see `platform/http.ts`); this is the Node side of
 * that seam. Node 18+ ships `fetch`, so there is no client library here either.
 *
 * The two things this does beyond calling `fetch`:
 *
 * - **Identifies itself.** A store operator reading their logs should be able
 *   to tell what this is and who to complain to. An honest User-Agent is the
 *   cheapest possible form of that, and CLAUDE.md §2 rules out the alternative:
 *   nothing here pretends to be a browser it is not.
 * - **Lowercases response headers**, because `HttpResponse` requires it and
 *   `header()` would otherwise miss on a server that capitalises differently.
 *
 * No retries. A retry that pushes past a block is exactly what §2 forbids, and
 * `createPoliteClient` already owns pacing and block detection.
 */

import type { HttpClient, HttpRequest, HttpResponse } from '@proc123/core';

export interface FetchClientOptions {
  /** Sent as `User-Agent`. Overridable so a user can add their own contact. */
  userAgent?: string;
  /** Per-request ceiling. A store that never answers must not hang a crawl. */
  timeoutMs?: number;
}

const DEFAULT_USER_AGENT =
  'proc123/1.8.0 (+https://github.com/hami9/proc123) catalogue-migration-tool';

const DEFAULT_TIMEOUT_MS = 20_000;

export function createFetchClient(options: FetchClientOptions = {}): HttpClient {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (request: HttpRequest): Promise<HttpResponse> => {
    // Two signals to honour: the caller's, and our own timeout. `AbortSignal.any`
    // is the only way to wait on both without leaking a timer per request.
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal =
      request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);

    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: { 'user-agent': userAgent, ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: 'follow',
      signal,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    return {
      status: response.status,
      headers,
      body: await response.text(),
      url: response.url,
    };
  };
}
