/**
 * Request pacing, and the latch that stops a scan dead.
 *
 * Two jobs, both from the brief. CLAUDE.md §10: politeness is on by default and
 * exists so a scan does not degrade the store it is reading. CLAUDE.md §2: when
 * the site signals a block, the scan stops — so the block check lives here,
 * where every request has to pass through it, rather than in each adapter where
 * one could forget.
 *
 * Pacing is on request *starts*, not completions, so a slow server does not
 * make the scan speed up once it recovers.
 */

import { type BlockDetection, SiteBlockedError, detectBlock } from './blocking.js';
import type { HttpClient, HttpRequest, HttpResponse } from './http.js';
import type { Politeness } from './types.js';

/** CLAUDE.md §9's example config, used as the default. */
export const DEFAULT_DELAY_MS = 800;
export const DEFAULT_MAX_CONCURRENT = 2;

export interface PoliteClientOptions extends Politeness {
  /** Injected so tests do not spend wall-clock time. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected alongside `sleep` to keep pacing deterministic in tests. */
  now?: () => number;
}

export interface PoliteClient {
  fetch: HttpClient;
  /** Requests actually sent. */
  readonly requests: number;
  /**
   * Set once the site signalled a block. From then on every request throws a
   * `SiteBlockedError` without being sent.
   */
  readonly blocked: BlockDetection | undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a client so that requests are spaced out, limited in flight, and checked
 * for a block before their body is ever handed back to an adapter.
 */
export function createPoliteClient(
  client: HttpClient,
  options: PoliteClientOptions = {}
): PoliteClient {
  const delay = Math.max(0, options.delayMsBetweenRequests ?? DEFAULT_DELAY_MS);
  const limit = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  let requests = 0;
  // The latch stores the *detection*, not the error, so every throw site
  // constructs its own instance and carries its own stack.
  let latched: { detection: BlockDetection; url: string } | undefined;

  const raiseIfBlocked = (): void => {
    if (latched === undefined) return;
    throw new SiteBlockedError(latched.detection, latched.url);
  };

  let active = 0;
  const waiting: (() => void)[] = [];
  let nextStart = 0;

  const acquire = async (): Promise<void> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
  };

  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };

  const pace = async (): Promise<void> => {
    const current = now();
    const wait = Math.max(0, nextStart - current);
    nextStart = Math.max(current, nextStart) + delay;
    if (wait > 0) await sleep(wait);
  };

  const fetch: HttpClient = async (request: HttpRequest): Promise<HttpResponse> => {
    // Once a site has said no, it has said no for the whole scan. This is the
    // §2 rule in code: no further requests, no backoff, no second opinion.
    raiseIfBlocked();

    await acquire();
    try {
      // Re-checked after the wait: another request in flight may have latched.
      await pace();
      raiseIfBlocked();

      requests += 1;
      const response = await client(request);
      const url = response.url ?? request.url;
      const withUrl: HttpResponse = response.url === undefined ? { ...response, url } : response;

      const detection = detectBlock(withUrl);
      if (detection !== undefined) {
        latched = { detection, url };
        throw new SiteBlockedError(detection, url);
      }

      return withUrl;
    } finally {
      release();
    }
  };

  return {
    fetch,
    get requests() {
      return requests;
    },
    get blocked(): BlockDetection | undefined {
      return latched?.detection;
    },
  };
}
