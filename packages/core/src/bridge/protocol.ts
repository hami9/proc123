/**
 * The app ↔ extension bridge protocol (CLAUDE.md §17).
 *
 * This module is the contract and nothing else: constants, shapes, and the
 * small pure functions that build and validate them. It makes no requests and
 * knows nothing about either surface. Both ends import it so that there is one
 * definition of the wire format rather than two that drift — the same reason
 * `runScan` moved into `core` in phase 16.
 *
 * **The security model is three properties and none of them is optional.**
 * The app binds loopback only, reports its port to the user, and generates a
 * token per run that it never writes down. There is deliberately no account, no
 * key exchange and no second scheme to fall back to: a bridge that could be
 * reached from off-machine, or with a token that outlived the process, would be
 * a remote-control server shipped inside a scraper.
 *
 * `buildBridgeUrl` is where the first of those becomes enforceable rather than
 * merely intended — it refuses to name any host but loopback, so a caller
 * cannot be talked into pointing the extension somewhere else by a value that
 * arrived from a page.
 */

/** Bumped when the shapes below change incompatibly. Sent in the hello. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/**
 * The token travels in a header rather than the query string, so it stays out
 * of any log line that records a URL.
 */
export const BRIDGE_TOKEN_HEADER = 'x-proc123-token';

/**
 * Loopback, as an IP literal.
 *
 * Not `localhost`: that resolves through the host file and DNS, can answer as
 * `::1` or something else entirely, and is a name somebody can repoint. The
 * literal cannot be redirected, which is the whole reason §17 names it this way.
 */
export const BRIDGE_HOST = '127.0.0.1';

/** Every route lives under this prefix, so the paths read as what they are. */
export const BRIDGE_PATH_PREFIX = '/bridge';

/** Hex characters in a token: 16 bytes of randomness. */
export const BRIDGE_TOKEN_LENGTH = 32;

/** What the app answers on `GET /bridge/hello`, once the token checks out. */
export interface BridgeHello {
  name: 'proc123';
  protocol: number;
  /** The app's version, so a mismatch can be explained rather than guessed at. */
  version: string;
  /** `linux` | `windows` | `android`. */
  platform: string;
}

/**
 * What the extension lends: the page as the browser actually rendered it, in a
 * session the app does not have.
 *
 * There is no `cookies` field, and that is a decision rather than an omission.
 * Handing the app a session would let it crawl page two of a shop the user is
 * logged in to — but it also means a token-authenticated local service holding
 * live credentials for someone's store, which is a much larger thing to get
 * right than this phase can honestly claim to. What the app receives here is
 * one already-rendered page and nothing that could fetch another.
 */
export interface BridgePageOffer {
  url: string;
  title: string;
  /** The rendered DOM, serialised. */
  html: string;
}

/** The app's answer to an accepted offer. */
export interface BridgeScanAccepted {
  scanId: string;
}

/**
 * Where a scan has got to.
 *
 * `summary` is `ScanSummary` from `core`'s scan module, carried as-is rather
 * than re-described here — the bridge moves it, it does not interpret it.
 */
export interface BridgeScanState {
  scanId: string;
  done: boolean;
  /** Present while running. */
  progress?: unknown;
  /** Present once `done`, unless `error` is. */
  summary?: unknown;
  /** Present instead of `summary` when the scan failed. */
  error?: string;
}

/**
 * Build a URL for one bridge route.
 *
 * Refuses anything but a usable loopback port. The host is not a parameter at
 * all: there is no legitimate reason to address this service anywhere else, and
 * making it an argument would create a way to be pointed elsewhere.
 */
export function buildBridgeUrl(port: number, path: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`not a usable port: ${String(port)}`);
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `http://${BRIDGE_HOST}:${String(port)}${BRIDGE_PATH_PREFIX}${suffix}`;
}

/** A token the app could plausibly have generated: fixed-length lowercase hex. */
export function isBridgeToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^[0-9a-f]{${String(BRIDGE_TOKEN_LENGTH)}}$`).test(value)
  );
}

/**
 * What the app shows and the user pastes into the extension.
 *
 * One string rather than two fields, because pairing is a step a person
 * performs by hand and two boxes is two chances to get it wrong.
 */
export function formatPairingCode(port: number, token: string): string {
  if (!isBridgeToken(token)) throw new Error('not a bridge token');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`not a usable port: ${String(port)}`);
  }
  return `${String(port)}-${token}`;
}

export interface BridgePairing {
  port: number;
  token: string;
}

/**
 * Read a pasted pairing code.
 *
 * Returns `undefined` rather than throwing: this is fed by a text box, so
 * "not valid yet" is the ordinary state while somebody is still typing, not an
 * error worth an exception.
 */
export function parsePairingCode(text: string): BridgePairing | undefined {
  const trimmed = text.trim();
  const split = trimmed.indexOf('-');
  if (split <= 0) return undefined;

  const port = Number(trimmed.slice(0, split));
  const token = trimmed.slice(split + 1);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  if (!isBridgeToken(token)) return undefined;
  return { port, token };
}

/** Is this the app answering, and a version we can talk to? */
export function isBridgeHello(value: unknown): value is BridgeHello {
  if (typeof value !== 'object' || value === null) return false;
  const hello = value as Partial<BridgeHello>;
  return (
    hello.name === 'proc123' &&
    hello.protocol === BRIDGE_PROTOCOL_VERSION &&
    typeof hello.version === 'string' &&
    typeof hello.platform === 'string'
  );
}
