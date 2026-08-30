/**
 * The app's end of the bridge (CLAUDE.md §17).
 *
 * Rust owns the socket, the token and the port; this file owns what an offer
 * *means*, which is to say it owns none of it either — it hands the page
 * straight to `runScan` in `core`, the same function the extension and the
 * companion call. That is the rule phase 17 states twice: the bridge carries
 * pages and results, `core` decides what they are. A shortcut here would be a
 * second implementation of the pipeline living in the surface least likely to
 * be tested.
 *
 * **The offered page is scanned as given and never re-fetched.** Re-fetching
 * would throw away the one thing the extension has that this app does not — a
 * session the user is logged in to — and would quietly turn an authenticated
 * page into whatever a logged-out visitor sees.
 */

import { createMemoryStore } from './scan.js';
import { runScan, type Proc123Config, type ScanSummary } from '@proc123/core';

/** Mirrors `PageOffer` in `bridge.rs`, which serialises as camelCase. */
export interface BridgeOffer {
  scanId: string;
  url: string;
  title: string;
  html: string;
}

export interface BridgeIdentity {
  port: number;
  token: string;
}

interface TauriGlobal {
  core?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
  event?: {
    listen?: (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
  };
}

function tauri(): TauriGlobal | undefined {
  return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/**
 * What the user pastes into the extension.
 *
 * `undefined` rather than an error when the bridge did not start: §17 says
 * both surfaces work alone, so an app whose port was unavailable is an app
 * with no bridge, not a broken app. The UI says so in words.
 */
export async function bridgeIdentity(): Promise<BridgeIdentity | undefined> {
  const invoke = tauri()?.core?.invoke;
  if (invoke === undefined) return undefined;
  try {
    return await invoke<BridgeIdentity>('bridge_info');
  } catch {
    return undefined;
  }
}

function isOffer(value: unknown): value is BridgeOffer {
  if (typeof value !== 'object' || value === null) return false;
  const offer = value as Partial<BridgeOffer>;
  return (
    typeof offer.scanId === 'string' &&
    typeof offer.url === 'string' &&
    typeof offer.html === 'string'
  );
}

async function report(scanId: string, state: Record<string, unknown>): Promise<void> {
  const invoke = tauri()?.core?.invoke;
  if (invoke === undefined) return;
  try {
    await invoke('bridge_report', { scanId, state });
  } catch {
    // A report that cannot be delivered is not worth failing a scan over: the
    // extension will simply keep seeing the last state it was given.
  }
}

/**
 * Run one offered page and report where it got to.
 *
 * Exported so it can be driven directly in a test without a running socket.
 */
export async function runOffer(
  offer: BridgeOffer,
  config?: Proc123Config
): Promise<ScanSummary | undefined> {
  try {
    const summary = await runScan(
      {
        page: { url: offer.url, html: offer.html },
        title: offer.title,
        ...(config === undefined ? {} : { config }),
      },
      {
        store: createMemoryStore(),
        onProgress: (progress) => {
          void report(offer.scanId, {
            scanId: offer.scanId,
            done: false,
            progress,
          });
        },
      }
    );
    await report(offer.scanId, {
      scanId: offer.scanId,
      done: true,
      summary,
    });
    return summary;
  } catch (error) {
    await report(offer.scanId, {
      scanId: offer.scanId,
      done: true,
      error: error instanceof Error ? error.message : 'the scan failed',
    });
    return undefined;
  }
}

/**
 * Start listening for pages the extension lends.
 *
 * Returns a no-op when there is no Tauri around it, which is what happens when
 * the front end is opened directly in a browser during development — the same
 * guard every other native call in this app uses.
 */
export async function listenForOffers(onOffer: (offer: BridgeOffer) => void): Promise<() => void> {
  const listen = tauri()?.event?.listen;
  if (listen === undefined) return () => undefined;
  return await listen('bridge://offer', (event) => {
    if (isOffer(event.payload)) onOffer(event.payload);
  });
}
