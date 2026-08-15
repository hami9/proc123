/**
 * Recognising that a site does not want to be read, and stopping.
 *
 * CLAUDE.md §2 is a permanent constraint on this repository. proc123 does not
 * solve CAPTCHAs, does not spoof fingerprints, does not rotate proxies, and has
 * no retry that pushes past an active block. When a site signals one, the
 * correct behaviour is: **stop the scan, log it, tell the user the site blocks
 * automated reading.**
 *
 * So this file only detects. There is deliberately no backoff-and-retry here,
 * and none should be added: a retry loop is the thing §2 forbids, wearing a
 * respectable name. `SiteBlockedError` is terminal by design — `polite.ts`
 * latches on it and refuses every later request in the same scan.
 *
 * A 404 is *not* a block. An endpoint that is switched off is a normal answer
 * meaning "not available here", and the caller falls through to another layer.
 */

import type { HttpResponse } from './http.js';
import { header } from './http.js';

export type BlockSignal =
  /** An interstitial challenge — CAPTCHA, JS challenge, "checking your browser". */
  | 'captcha'
  /** 403: the server refused outright. */
  | 'forbidden'
  /** 429, or a rate-limit header that has run out. */
  | 'rate-limited'
  /** 401: the catalogue is behind a login, so it is not public. */
  | 'login-required';

export interface BlockDetection {
  signal: BlockSignal;
  status: number;
  /** Written for the user, not for a log parser. */
  reason: string;
  /** The marker that fired, so a false positive can be traced. */
  evidence: string;
}

/**
 * Body markers left by the common interstitials.
 *
 * Matched against the first slice of the body only: a challenge page is small
 * and says so immediately, whereas a real catalogue page can mention "captcha"
 * halfway down in a review and must not be mistaken for one.
 */
const CHALLENGE_MARKERS: readonly (readonly [marker: string, label: string])[] = [
  ['/cdn-cgi/challenge-platform/', 'Cloudflare challenge platform script'],
  ['cf-browser-verification', 'Cloudflare browser verification'],
  ['cf_chl_opt', 'Cloudflare challenge options'],
  ['just a moment...', 'Cloudflare "Just a moment..." interstitial'],
  ['attention required! | cloudflare', 'Cloudflare block page'],
  ['checking your browser before accessing', 'browser-check interstitial'],
  ['g-recaptcha', 'reCAPTCHA widget'],
  ['h-captcha', 'hCaptcha widget'],
  ['_incapsula_resource', 'Imperva/Incapsula challenge'],
  ['captcha-delivery.com', 'DataDome challenge'],
  ['px-captcha', 'PerimeterX challenge'],
  ['/_sec/cp_challenge/', 'Akamai challenge'],
];

/** How much of the body to inspect. Challenge pages are tiny. */
const CHALLENGE_WINDOW = 4096;

function findChallenge(body: string): string | undefined {
  const window = body.slice(0, CHALLENGE_WINDOW).toLowerCase();
  for (const [marker, label] of CHALLENGE_MARKERS) {
    if (window.includes(marker)) return label;
  }
  return undefined;
}

/**
 * Decide whether a response is the site telling us to stop.
 *
 * Returns `undefined` for everything else, including 404 and 500 — a missing
 * endpoint and a broken server are not refusals to be read.
 */
export function detectBlock(response: HttpResponse): BlockDetection | undefined {
  const url = response.url ?? '';

  // Cloudflare sets this on any request it acted on, whatever the status.
  const mitigated = header(response, 'cf-mitigated');
  if (mitigated !== undefined && mitigated.toLowerCase() === 'challenge') {
    return {
      signal: 'captcha',
      status: response.status,
      reason: `${describe(url)} served a Cloudflare challenge instead of the page.`,
      evidence: 'cf-mitigated: challenge',
    };
  }

  if (response.status === 429) {
    return {
      signal: 'rate-limited',
      status: 429,
      reason: `${describe(url)} is rate limiting this scan (HTTP 429).`,
      evidence: 'HTTP 429',
    };
  }

  if (response.status === 401) {
    return {
      signal: 'login-required',
      status: 401,
      reason: `${describe(url)} requires a login for this catalogue, so it is not public.`,
      evidence: 'HTTP 401',
    };
  }

  if (response.status === 403) {
    const challenge = findChallenge(response.body);
    return {
      signal: challenge === undefined ? 'forbidden' : 'captcha',
      status: 403,
      reason:
        challenge === undefined
          ? `${describe(url)} refused the request (HTTP 403).`
          : `${describe(url)} answered with a challenge page (HTTP 403).`,
      evidence: challenge ?? 'HTTP 403',
    };
  }

  // A challenge served with a 200 or a 503 is the most common shape of all.
  const challenge = findChallenge(response.body);
  if (challenge !== undefined && (response.status === 200 || response.status === 503)) {
    return {
      signal: 'captcha',
      status: response.status,
      reason: `${describe(url)} answered with a challenge page instead of content.`,
      evidence: challenge,
    };
  }

  return undefined;
}

function describe(url: string): string {
  if (url === '') return 'The site';
  try {
    return new URL(url).hostname;
  } catch {
    return 'The site';
  }
}

/**
 * Thrown once, when a site signals a block. Terminal: nothing in this codebase
 * catches it to retry, and nothing should.
 */
export class SiteBlockedError extends Error {
  readonly signal: BlockSignal;
  readonly status: number;
  readonly evidence: string;
  readonly url: string;

  constructor(detection: BlockDetection, url: string) {
    super(
      `${detection.reason} proc123 stops scanning when a site signals a block, ` +
        `and does not work around one.`
    );
    this.name = 'SiteBlockedError';
    this.signal = detection.signal;
    this.status = detection.status;
    this.evidence = detection.evidence;
    this.url = url;
  }
}

export function isSiteBlockedError(error: unknown): error is SiteBlockedError {
  return error instanceof SiteBlockedError;
}
