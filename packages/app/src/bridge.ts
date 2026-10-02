/**
 * The bridge, as the app's front end sees it (CLAUDE.md §17).
 *
 * Rust owns the socket; this owns two things and nothing else: reading the
 * pairing details so the UI can show them, and subscribing to the handoffs that
 * arrive on it.
 *
 * Everything here is written so the app is unchanged when there is no bridge at
 * all. `bridgeInfo()` answers `undefined` when the listener never bound or when
 * the bundle is open in a plain browser, and `onHandoff` returns a no-op
 * unsubscribe in the same case. §17 requires the app to be fully usable with
 * the extension uninstalled, and the simplest way to keep a requirement like
 * that is for the absent case to be the ordinary code path rather than a branch
 * somebody has to remember.
 */

/** The subset of Tauri's global this file needs. */
interface TauriGlobal {
  core?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
  event?: {
    listen?: <T>(event: string, handler: (payload: { payload: T }) => void) => Promise<() => void>;
  };
}

/** Mirrors `BridgeInfo` in `src-tauri/src/bridge.rs`. */
export interface BridgeInfo {
  port: number;
  token: string;
  protocol: number;
}

/** Mirrors `Handoff` in `src-tauri/src/bridge.rs`. */
export interface Handoff {
  url: string;
  title: string;
  html: string;
}

function tauri(): TauriGlobal | undefined {
  return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/**
 * Where the bridge is listening, and the code that pairs with it.
 *
 * `undefined` means there is no bridge — no port was free, or this is the
 * bundle running in a browser — and the UI's job is then to say the app works
 * on its own, which it does.
 */
export async function bridgeInfo(): Promise<BridgeInfo | undefined> {
  const invoke = tauri()?.core?.invoke;
  if (invoke === undefined) return undefined;
  try {
    return (await invoke<BridgeInfo | null>('bridge_info')) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Format the token the way it is read off a screen and typed into another.
 *
 * Grouping is presentation only — both sides strip it before comparing — but it
 * is the difference between a code someone copies correctly the first time and
 * one they do not.
 */
export function formatToken(token: string): string {
  return token.length === 8 ? `${token.slice(0, 4)}-${token.slice(4)}` : token;
}

/**
 * Run `handler` whenever the extension hands a page over.
 *
 * Returns an unsubscribe. In a plain browser there is nothing to subscribe to,
 * and the no-op it returns instead keeps the caller's teardown identical.
 */
export async function onHandoff(handler: (handoff: Handoff) => void): Promise<() => void> {
  const listen = tauri()?.event?.listen;
  if (listen === undefined) return () => undefined;
  try {
    return await listen<Handoff>('bridge://handoff', (event) => {
      handler(event.payload);
    });
  } catch {
    return () => undefined;
  }
}
