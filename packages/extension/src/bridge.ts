/**
 * The extension's end of the bridge (CLAUDE.md §17).
 *
 * **This module is only ever imported by the service worker.** A content script
 * runs in the page, and a page on HTTPS cannot open `http://127.0.0.1` at all —
 * that is mixed-content blocking, which is a rule rather than a bug, and §3
 * says so twice. The worker has no origin of its own and is not subject to it.
 *
 * **The extension must stay whole without the app.** Every function here can
 * fail, and failing is an ordinary state rather than an error to propagate:
 * `probeBridge` answers "no" for a closed port exactly as it does for a wrong
 * token, and nothing in the popup's normal path calls any of this. Scanning,
 * exporting, teaching a selector and the inspector all work with no app on the
 * machine, which is the property phase 17 has to keep rather than acquire.
 */

import {
  BRIDGE_TOKEN_HEADER,
  buildBridgeUrl,
  isBridgeHello,
  parsePairingCode,
  type BridgeHello,
  type BridgePageOffer,
  type BridgePairing,
  type BridgeScanAccepted,
  type BridgeScanState,
} from '@proc123/core';

import { storage } from './browser.js';

/**
 * `session`, not `local`.
 *
 * The app generates the token per run and never writes it down; an extension
 * that kept it across a browser restart would be holding a credential for a
 * process that no longer exists, and would have broken the half of §17 it is
 * responsible for. `session` dies with the browser and never reaches disk, and
 * still survives the service-worker restarts MV3 imposes (§10).
 */
const PAIRING_KEY = 'proc123.bridge.pairing';

/**
 * A bridge that answers slowly is a bridge that is not there.
 *
 * Loopback has no meaningful latency, so anything past this is a port that
 * happens to be open and held by something that is not the app. Without a
 * bound, a popup asking "is the app running?" could hang on it.
 */
const PROBE_TIMEOUT_MS = 1_500;

export interface BridgeStatus {
  paired: boolean;
  reachable: boolean;
  /** Present when reachable. */
  hello?: BridgeHello;
  /** Why it is not reachable, in words a person can act on. */
  reason?: string;
}

export async function loadPairing(): Promise<BridgePairing | undefined> {
  const stored = await storage.session.get(PAIRING_KEY);
  const raw = stored[PAIRING_KEY];
  return typeof raw === 'string' ? parsePairingCode(raw) : undefined;
}

/** Returns the parsed pairing so the caller can report a bad paste as one. */
export async function savePairing(code: string): Promise<BridgePairing | undefined> {
  const pairing = parsePairingCode(code);
  if (pairing === undefined) return undefined;
  await storage.session.set({ [PAIRING_KEY]: code.trim() });
  return pairing;
}

export async function forgetPairing(): Promise<void> {
  await storage.session.remove(PAIRING_KEY);
}

/**
 * One request to the bridge.
 *
 * `signal` carries a deadline rather than the request being left to the
 * network stack: a refused connection returns quickly, but a port held open by
 * something that never answers would otherwise hang forever.
 */
async function request(
  pairing: BridgePairing,
  path: string,
  init: { method: string; body?: unknown },
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    // Spread rather than `body: undefined`: `exactOptionalPropertyTypes` makes
    // an explicit undefined a different thing from an absent property, and
    // `RequestInit` does not accept it.
    const response = await fetch(buildBridgeUrl(pairing.port, path), {
      method: init.method,
      headers: {
        [BRIDGE_TOKEN_HEADER]: pairing.token,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error('the app rejected the pairing code');
    if (!response.ok) throw new Error(`the app answered ${String(response.status)}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the app there, and is it the app?
 *
 * Never throws. "No app" is the default state on most machines, not a failure,
 * and a caller that had to catch would be a caller that could forget to.
 */
export async function probeBridge(): Promise<BridgeStatus> {
  const pairing = await loadPairing();
  if (pairing === undefined) return { paired: false, reachable: false };

  try {
    const body = await request(pairing, '/hello', { method: 'GET' }, PROBE_TIMEOUT_MS);
    if (!isBridgeHello(body)) {
      return {
        paired: true,
        reachable: false,
        reason: 'something else is listening on that port',
      };
    }
    return { paired: true, reachable: true, hello: body };
  } catch (error) {
    return {
      paired: true,
      reachable: false,
      reason: error instanceof Error ? error.message : 'the app did not answer',
    };
  }
}

/**
 * Hand the app the page this browser can see and it cannot.
 *
 * The offer carries no session (see `BridgePageOffer`): what crosses is one
 * already-rendered document. The app takes over from there, which is the whole
 * point — it outlives the popup, and this scan does not die when the user
 * closes it.
 */
export async function offerPage(offer: BridgePageOffer): Promise<BridgeScanAccepted> {
  const pairing = await loadPairing();
  if (pairing === undefined) throw new Error('no app is paired');
  const body = await request(pairing, '/scan', { method: 'POST', body: offer }, 30_000);
  const accepted = body as Partial<BridgeScanAccepted>;
  if (typeof accepted.scanId !== 'string') throw new Error('the app did not name the scan');
  return { scanId: accepted.scanId };
}

export async function readScanState(scanId: string): Promise<BridgeScanState> {
  const pairing = await loadPairing();
  if (pairing === undefined) throw new Error('no app is paired');
  const body = await request(
    pairing,
    `/status?id=${encodeURIComponent(scanId)}`,
    { method: 'GET' },
    PROBE_TIMEOUT_MS * 4
  );
  const state = body as Partial<BridgeScanState>;
  if (typeof state.scanId !== 'string' || typeof state.done !== 'boolean') {
    throw new Error('the app reported a state this version does not understand');
  }
  return state as BridgeScanState;
}
