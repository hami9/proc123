import { readFileSync } from 'node:fs';

import type { HttpClient, HttpResponse, PageContext } from '@proc123/core';

export const SCANNED_AT = '2026-08-15T09:00:00.000Z';

export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

export function page(name: string, url: string): PageContext {
  return { url, html: fixture(name) };
}

export interface Route {
  status?: number;
  /** An object is serialized and served as JSON; a string is served verbatim. */
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * A canned HTTP client. CLAUDE.md §12 — no live network in tests, ever.
 *
 * An unmatched request answers 404 with an HTML body, which is what a store
 * that has switched an endpoint off actually returns: not a JSON error, its own
 * "not found" page.
 */
export function fakeHttp(
  routes: readonly (readonly [string | RegExp, Route])[],
  log: string[] = []
): HttpClient {
  return (request) => {
    log.push(request.url);

    const match = routes.find(([pattern]) =>
      typeof pattern === 'string' ? request.url.includes(pattern) : pattern.test(request.url)
    );

    if (match === undefined) {
      return Promise.resolve({
        status: 404,
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><html><body><h1>Not found</h1></body></html>',
        url: request.url,
      });
    }

    const [, route] = match;
    const isText = typeof route.body === 'string';

    const response: HttpResponse = {
      status: route.status ?? 200,
      headers: {
        'content-type': isText ? 'text/html' : 'application/json',
        ...(route.headers ?? {}),
      },
      body: isText ? (route.body as string) : JSON.stringify(route.body ?? {}),
      url: request.url,
    };
    return Promise.resolve(response);
  };
}

/** No wall-clock waiting; the requested delays are recorded instead. */
export function fakeClock(): {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  waits: number[];
} {
  const waits: number[] = [];
  let clock = 0;
  return {
    waits,
    now: () => clock,
    sleep: (ms: number) => {
      waits.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  };
}
