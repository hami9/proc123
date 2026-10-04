/**
 * The bridge, extension side (CLAUDE.md §17).
 *
 * The test that matters most here is the one that asserts an *absence*: §17
 * requires the extension to be fully usable with no app installed, and that is
 * a property which rots silently. Nothing fails loudly when a bridge call
 * starts throwing on a machine with no app — the popup just stops working for
 * everyone who never installed one, which is almost everyone.
 *
 * `fetch` is injected throughout, so none of this touches a socket (§12).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PORT_RANGE,
  PROTOCOL_VERSION,
  discoverBridge,
  handOffToApp,
  loadBridgeToken,
  normalizeToken,
  saveBridgeToken,
  sendPageToApp,
} from '../src/bridge.js';
import type { FetchLike } from '../src/bridge.js';

const PAGE = {
  url: 'https://shop.example/product-category/nuts/',
  title: 'Nuts',
  html: '<html><body><div class="product">x</div></body></html>',
};

/** A loopback that nothing is listening on: every port refuses. */
const nothingListening: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));

/** An app answering `hello` on one port and accepting one token. */
function appOn(port: number, token: string, protocol = PROTOCOL_VERSION): FetchLike {
  return (input, init) => {
    const url = new URL(input);
    if (url.port !== String(port)) return Promise.reject(new Error('ECONNREFUSED'));

    if (url.pathname === '/bridge/hello') {
      return Promise.resolve(
        new Response(JSON.stringify({ app: 'proc123', protocol, version: '1.10.0' }), {
          status: 200,
        })
      );
    }

    if (url.pathname === '/bridge/handoff') {
      const offered = String(
        (init?.headers as Record<string, string> | undefined)?.['authorization'] ?? ''
      ).replace(/^Bearer /, '');
      if (normalizeToken(offered) !== token) {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    }

    return Promise.resolve(new Response('{}', { status: 404 }));
  };
}

function storageArea(): chrome.storage.StorageArea {
  const held: Record<string, unknown> = {};
  return {
    get: (keys) => {
      const wanted = keys === null ? Object.keys(held) : [keys].flat();
      return Promise.resolve(
        Object.fromEntries(wanted.filter((key) => key in held).map((key) => [key, held[key]]))
      );
    },
    set: (values) => {
      Object.assign(held, values);
      return Promise.resolve();
    },
    remove: (keys) => {
      for (const key of [keys].flat()) delete held[key];
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('chrome', { storage: { local: storageArea(), session: storageArea() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session-only pairing', () => {
  it('keeps the code across worker reloads without writing it to disk', async () => {
    await saveBridgeToken('abcd-1234', 8787);
    expect(await chrome.storage.local.get(null)).toEqual({});
    vi.resetModules();
    const reloaded = await import('../src/bridge.js');
    await expect(reloaded.loadBridgeToken()).resolves.toBe('ABCD1234');
  });

  it('forgets pairing when the browser session ends', async () => {
    await saveBridgeToken('ABCD1234', 8787);
    vi.stubGlobal('chrome', { storage: { local: chrome.storage.local, session: storageArea() } });
    await expect(loadBridgeToken()).resolves.toBeUndefined();
  });

  it('deletes legacy persistent codes instead of restoring them', async () => {
    await chrome.storage.local.set({
      'proc123.bridge.token': 'OLD12345',
      'proc123.bridge.port': 8787,
      config: 'keep',
    });
    await expect(loadBridgeToken()).resolves.toBeUndefined();
    expect(await chrome.storage.local.get(null)).toEqual({ config: 'keep' });
  });

  it('never falls back to disk when session storage is unavailable', async () => {
    vi.stubGlobal('chrome', { storage: { local: storageArea() } });
    await expect(loadBridgeToken()).resolves.toBeUndefined();
    await expect(saveBridgeToken('ABCD1234', 8787)).rejects.toThrow('in memory');
    expect(await chrome.storage.local.get(null)).toEqual({});
    await expect(sendPageToApp(nothingListening, PAGE, undefined)).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });
});

describe('working with no app installed', () => {
  it('discovers nothing and does not throw', async () => {
    await expect(discoverBridge(nothingListening)).resolves.toBeUndefined();
  });

  it('reports the handoff as unreachable rather than failing', async () => {
    const outcome = await sendPageToApp(nothingListening, PAGE, 'ABCD1234');
    expect(outcome).toEqual({ ok: false, reason: 'unreachable' });
  });

  /**
   * The specific shape of "degrades cleanly": a port that answers something
   * that is not proc123 — a dev server, a printer, anything — must read as no
   * app rather than as a bridge that then fails strangely.
   */
  it('ignores a port that answers with something else entirely', async () => {
    const somethingElse: FetchLike = () =>
      Promise.resolve(new Response('<html>a dev server</html>', { status: 200 }));
    await expect(discoverBridge(somethingElse)).resolves.toBeUndefined();
  });

  it('never throws, whatever fetch does', async () => {
    const hostile: FetchLike = () => {
      throw new Error('synchronous explosion');
    };
    await expect(discoverBridge(hostile)).resolves.toBeUndefined();
  });
});

describe('finding the app', () => {
  it('finds it on any port in the range', async () => {
    for (const port of [PORT_RANGE[0], PORT_RANGE[4], PORT_RANGE.at(-1)] as number[]) {
      const found = await discoverBridge(appOn(port, 'ABCD1234'));
      expect(found).toMatchObject({ port, protocol: PROTOCOL_VERSION, version: '1.10.0' });
    }
  });

  it('refuses to pair across a protocol it does not speak', async () => {
    const outcome = await sendPageToApp(appOn(8787, 'ABCD1234', 99), PAGE, 'ABCD1234');
    expect(outcome).toEqual({ ok: false, reason: 'protocol', appProtocol: 99 });
  });
});

describe('handing a page over', () => {
  it('sends the page and reports success', async () => {
    const fetchImpl = vi.fn(appOn(8787, 'ABCD1234'));
    const outcome = await sendPageToApp(fetchImpl, PAGE, 'abcd-1234');
    expect(outcome).toEqual({ ok: true });

    const call = fetchImpl.mock.calls.find(([url]) => url.includes('/bridge/handoff'));
    expect(call).toBeDefined();
    // The rendered DOM is the payload. A handoff that carried only the URL
    // would be handing over nothing the app could not fetch for itself (§17).
    const body = call?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual(PAGE);
  });

  it('only ever talks to loopback', async () => {
    const fetchImpl = vi.fn(appOn(8787, 'ABCD1234'));
    await sendPageToApp(fetchImpl, PAGE, 'ABCD1234');
    for (const [url] of fetchImpl.mock.calls) {
      expect(new URL(url).hostname).toBe('127.0.0.1');
    }
  });

  it('calls a stale pairing code unauthorised rather than an error', async () => {
    const outcome = await handOffToApp(
      appOn(8787, 'ABCD1234'),
      { port: 8787, token: 'WRONG999' },
      PAGE
    );
    expect(outcome).toEqual({ ok: false, reason: 'unauthorised' });
  });

  /**
   * The app's token is per-run and dies with the process (§17), so a stored one
   * goes stale on every restart. Keeping it would mean the next handoff fails
   * the same way with nothing having changed; dropping it is what makes the
   * popup ask for the new code.
   */
  it('forgets a code the app has rejected', async () => {
    const { saveBridgeToken, loadBridgeToken } = await import('../src/bridge.js');
    await saveBridgeToken('ABCD-1234', 8787);
    await expect(loadBridgeToken()).resolves.toBe('ABCD1234');

    await handOffToApp(appOn(8787, 'ZZZZ9999'), { port: 8787, token: 'ABCD1234' }, PAGE);
    await expect(loadBridgeToken()).resolves.toBeUndefined();
  });

  it('refuses to send without a code at all', async () => {
    const fetchImpl = vi.fn(appOn(8787, 'ABCD1234'));
    const outcome = await sendPageToApp(fetchImpl, PAGE, undefined);
    expect(outcome).toEqual({ ok: false, reason: 'unauthorised' });
    expect(fetchImpl.mock.calls.some(([url]) => url.includes('/bridge/handoff'))).toBe(false);
  });
});

describe('the pairing code as a person types it', () => {
  it('ignores the grouping dash and the case', () => {
    expect(normalizeToken('abcd-1234')).toBe('ABCD1234');
    expect(normalizeToken(' ABCD 1234 ')).toBe('ABCD1234');
    expect(normalizeToken('ABCD1234')).toBe('ABCD1234');
  });
});
