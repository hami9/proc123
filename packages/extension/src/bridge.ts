/**
 * The bridge, extension side (CLAUDE.md §17).
 *
 * The app can fetch anything and write to disk; it cannot see a shop the user
 * is logged in to, because its WebView starts with no cookies and is not the
 * browser the user trusts. This module lends it the one thing only the
 * extension has — the rendered DOM of the tab in front of the user — and then
 * gets out of the way.
 *
 * **Three rules this file exists to keep.**
 *
 * - **Only the service worker may call this.** A content script runs on the
 *   shop's page, which is `https:`, and an `https:` page cannot reach
 *   `http://127.0.0.1` at all. That is mixed-content blocking, which is a
 *   browser security boundary and not a bug to work around (§3). The worker's
 *   own origin is `chrome-extension://`, which is exempt, and the app echoes
 *   only extension origins back in its CORS headers.
 * - **Everything degrades to nothing.** Every function here answers with a
 *   status rather than throwing, and every caller is required to carry on
 *   without the app. A build where the extension needs the app is a build that
 *   has broken §17.
 * - **It carries a page, not a decision.** What the app does with the page is
 *   the app's business; nothing here knows what a product is.
 *
 * `fetch` is injected so all of this is testable without a socket, which is
 * also how the "works with the app uninstalled" requirement gets asserted
 * rather than asserted-ish.
 */

import { storage } from './browser.js';

/** Must match `PROTOCOL_VERSION` in `packages/app/src-tauri/src/bridge.rs`. */
export const PROTOCOL_VERSION = 1;

/**
 * The ports the app tries, in the order it tries them.
 *
 * Mirrors `PORT_RANGE` on the Rust side. Two constants rather than one is the
 * price of the two halves being separate programs in separate languages; the
 * protocol check below is what turns a mismatch into a message instead of a
 * mystery.
 */
export const PORT_RANGE = [8787, 8788, 8789, 8790, 8791, 8792, 8793, 8794, 8795, 8796];

/** Long enough for a loopback round trip, short enough to probe ten of them. */
const PROBE_TIMEOUT_MS = 400;

const TOKEN_KEY = 'proc123.bridge.token';
const PORT_KEY = 'proc123.bridge.port';

export interface BridgeFound {
  port: number;
  protocol: number;
  version: string;
}

/**
 * Why a handoff did not happen, in terms the popup can show.
 *
 * `unauthorised` is the common one and is not a failure of anything: the app's
 * token is generated per run and dies with it (§17), so every app restart makes
 * a stored token stale. The popup's answer is to ask for the code again, not to
 * report an error.
 */
export type BridgeOutcome =
  | { ok: true }
  | { ok: false; reason: 'unreachable' }
  | { ok: false; reason: 'unauthorised' }
  | { ok: false; reason: 'protocol'; appProtocol: number }
  | { ok: false; reason: 'refused'; message: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The page the extension lends the app. */
export interface BridgePage {
  url: string;
  title: string;
  html: string;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Ask one port whether a proc123 app is behind it.
 *
 * Every failure is the same answer — `undefined` — because they are the same
 * thing to the caller: a closed port, a refused connection, a timeout and
 * something else entirely that happens to be listening all mean "not the app".
 */
async function probe(fetchImpl: FetchLike, port: number): Promise<BridgeFound | undefined> {
  const { signal, done } = withTimeout(PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${String(port)}/bridge/hello`, { signal });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return undefined;
    const hello = body as { app?: unknown; protocol?: unknown; version?: unknown };
    if (hello.app !== 'proc123' || typeof hello.protocol !== 'number') return undefined;
    return {
      port,
      protocol: hello.protocol,
      version: typeof hello.version === 'string' ? hello.version : '',
    };
  } catch {
    return undefined;
  } finally {
    done();
  }
}

/**
 * Find the app, if it is running.
 *
 * The ports are tried in parallel rather than in turn: ten sequential probes at
 * the timeout above is four seconds of a user watching nothing happen, and the
 * whole point of this call is that it is cheap enough to make whenever the
 * popup opens.
 *
 * A port that was found before is tried too, not instead — the app may have
 * moved, and preferring a stale answer is how "it worked yesterday" starts.
 */
export async function discoverBridge(fetchImpl: FetchLike): Promise<BridgeFound | undefined> {
  const found = await Promise.all(PORT_RANGE.map((port) => probe(fetchImpl, port)));
  return found.find((one) => one !== undefined);
}

/** The pairing code the user copied out of the app, if they have done that. */
export async function loadBridgeToken(): Promise<string | undefined> {
  // Remove older builds' disk-backed pairing codes. Never migrate the secret.
  await storage.local.remove([TOKEN_KEY, PORT_KEY]);
  const session = storage.session;
  if (session === undefined) return undefined;
  const stored = await session.get(TOKEN_KEY);
  const raw = stored[TOKEN_KEY];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/**
 * Keep the code in memory across popup closes and worker restarts, not across
 * browser sessions. Both copies authorise the same run and are secrets (§17).
 * Browsers without session storage can still scan without the bridge.
 */
export async function saveBridgeToken(token: string, port: number): Promise<void> {
  await storage.local.remove([TOKEN_KEY, PORT_KEY]);
  const session = storage.session;
  if (session === undefined) {
    throw new Error(
      'This browser cannot keep pairing codes in memory. Update it to use the bridge.'
    );
  }
  await session.set({ [TOKEN_KEY]: normalizeToken(token), [PORT_KEY]: port });
}

export async function forgetBridgeToken(): Promise<void> {
  await storage.local.remove([TOKEN_KEY, PORT_KEY]);
  await storage.session?.remove([TOKEN_KEY, PORT_KEY]);
}

/** Mirrors `normalize_token` in the app: the dash is presentation. */
export function normalizeToken(raw: string): string {
  return raw
    .split('')
    .filter((c) => /[a-z0-9]/i.test(c))
    .join('')
    .toUpperCase();
}

/**
 * Hand a page to the app.
 *
 * Returns rather than throws, in every case, because the one thing this must
 * never do is turn a missing app into a broken scan.
 */
export async function handOffToApp(
  fetchImpl: FetchLike,
  target: { port: number; token: string },
  page: BridgePage
): Promise<BridgeOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${String(target.port)}/bridge/handoff`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify(page),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (response.status === 401) {
    // Stale by design: the app has restarted since the code was typed. Dropping
    // it here is what makes the popup ask for a new one instead of silently
    // failing the next time too.
    await forgetBridgeToken();
    return { ok: false, reason: 'unauthorised' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'refused', message: `the app answered ${String(response.status)}` };
  }
  return { ok: true };
}

/**
 * The whole conversation: find the app, check the protocol, hand the page over.
 *
 * One call because the popup has one button. Each failure is distinguishable,
 * because "the app is not running" and "the code has gone stale" need different
 * sentences and a single boolean would collapse them.
 */
export async function sendPageToApp(
  fetchImpl: FetchLike,
  page: BridgePage,
  token: string | undefined
): Promise<BridgeOutcome> {
  const found = await discoverBridge(fetchImpl);
  if (found === undefined) return { ok: false, reason: 'unreachable' };
  if (found.protocol !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'protocol', appProtocol: found.protocol };
  }
  if (token === undefined || token === '') return { ok: false, reason: 'unauthorised' };
  return handOffToApp(fetchImpl, { port: found.port, token }, page);
}
