/**
 * The extension's end of the bridge (CLAUDE.md §17).
 *
 * Two of phase 17's acceptance criteria are properties rather than features,
 * and this is where they are held: the token is never written anywhere that
 * survives the browser, and **the extension is whole with no app installed**.
 * The second one is easy to lose later — one `await probeBridge()` added to a
 * path that used to work offline is all it takes — so it is asserted directly
 * rather than assumed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_TOKEN_HEADER, formatPairingCode } from '@proc123/core';

import {
  forgetPairing,
  loadPairing,
  offerPage,
  probeBridge,
  readScanState,
  savePairing,
} from '../src/bridge.js';
import { installFakeChrome, type FakeChrome } from './fake-chrome.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const PORT = 53_421;
const CODE = formatPairingCode(PORT, TOKEN);

let chrome: FakeChrome;

/** Records what was asked for, so the URL and headers can be asserted. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: unknown, init: unknown) =>
    handler(String(url), (init ?? {}) as RequestInit)
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const HELLO = { name: 'proc123', protocol: 1, version: '1.10.0', platform: 'windows' };

beforeEach(() => {
  chrome = installFakeChrome();
});

afterEach(() => {
  chrome.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pairing storage', () => {
  it('round-trips a pasted code', async () => {
    expect(await savePairing(CODE)).toEqual({ port: PORT, token: TOKEN });
    expect(await loadPairing()).toEqual({ port: PORT, token: TOKEN });
  });

  it('refuses a code that is not one, and stores nothing', async () => {
    expect(await savePairing('53421-nope')).toBeUndefined();
    expect(chrome.sessionStore.size).toBe(0);
  });

  /**
   * §17: the app generates the token per run and never persists it. The
   * extension keeping a copy in `local` would break that from this side, so
   * the token must be in `session` — memory only, gone when the browser is.
   */
  it('never writes the token where it would survive the browser', async () => {
    await savePairing(CODE);
    expect([...chrome.sessionStore.values()].join()).toContain(TOKEN);
    expect([...chrome.store.values()].join()).not.toContain(TOKEN);
    expect(chrome.store.size).toBe(0);
  });

  it('forgets on request', async () => {
    await savePairing(CODE);
    await forgetPairing();
    expect(await loadPairing()).toBeUndefined();
    expect(chrome.sessionStore.size).toBe(0);
  });
});

describe('probeBridge', () => {
  it('reports "not paired" before anything is pasted, without a request', async () => {
    const spy = stubFetch(() => json(HELLO));
    expect(await probeBridge()).toEqual({ paired: false, reachable: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('addresses loopback and sends the token in a header', async () => {
    await savePairing(CODE);
    const spy = stubFetch(() => json(HELLO));

    const status = await probeBridge();

    expect(status.reachable).toBe(true);
    expect(status.hello).toEqual(HELLO);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:' + String(PORT) + '/bridge/hello');
    expect((init.headers as Record<string, string>)[BRIDGE_TOKEN_HEADER]).toBe(TOKEN);
    expect(url).not.toContain(TOKEN);
  });

  /** A closed port is the ordinary case, not an exception to propagate. */
  it('answers "not reachable" when nothing is listening', async () => {
    await savePairing(CODE);
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const status = await probeBridge();
    expect(status).toMatchObject({ paired: true, reachable: false });
    expect(status.reason).toBeTruthy();
  });

  it('says so when the token is refused', async () => {
    await savePairing(CODE);
    stubFetch(() => json({ error: 'no' }, 401));
    expect((await probeBridge()).reason).toMatch(/rejected the pairing code/);
  });

  it('does not mistake another service on that port for the app', async () => {
    await savePairing(CODE);
    stubFetch(() => json({ name: 'grafana' }));
    const status = await probeBridge();
    expect(status.reachable).toBe(false);
    expect(status.reason).toMatch(/something else is listening/);
  });
});

describe('offerPage', () => {
  it('posts the page and returns the scan id', async () => {
    await savePairing(CODE);
    const spy = stubFetch(() => json({ scanId: 'scan-1' }));

    const accepted = await offerPage({ url: 'https://shop.example/c', title: 'Nuts', html: '<p>' });

    expect(accepted).toEqual({ scanId: 'scan-1' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:' + String(PORT) + '/bridge/scan');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://shop.example/c' });
  });

  /**
   * The offer deliberately carries no cookies — see `BridgePageOffer`. If a
   * session is ever handed over it should be a decision with its own review,
   * not something that arrives because a caller spread an extra field in.
   */
  it('sends no session with the page', async () => {
    await savePairing(CODE);
    const spy = stubFetch(() => json({ scanId: 'scan-1' }));
    await offerPage({ url: 'https://shop.example/c', title: 'Nuts', html: '<p>' });
    const sent = (spy.mock.calls[0] as [string, RequestInit])[1].body as string;
    const body = JSON.parse(sent) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['html', 'title', 'url']);
  });

  it('refuses when nothing is paired', async () => {
    await expect(offerPage({ url: 'u', title: 't', html: '<p>' })).rejects.toThrow(
      /no app is paired/
    );
  });
});

describe('readScanState', () => {
  it('carries the summary through without interpreting it', async () => {
    await savePairing(CODE);
    const summary = { rowCount: 12, currencyUnits: { toman: 12 } };
    const spy = stubFetch(() => json({ scanId: 'scan-1', done: true, summary }));

    const state = await readScanState('scan-1');

    expect(state.summary).toEqual(summary);
    expect((spy.mock.calls[0] as [string, RequestInit])[0]).toContain('/bridge/status?id=scan-1');
  });

  it('rejects a state it does not understand rather than guessing', async () => {
    await savePairing(CODE);
    stubFetch(() => json({ nonsense: true }));
    await expect(readScanState('scan-1')).rejects.toThrow(/does not understand/);
  });
});

/**
 * Phase 17's third acceptance criterion, asserted rather than described.
 *
 * Nothing the extension does for its own sake may reach for the bridge. If one
 * of these ever needs an app, that is a §17 violation ("both work alone") and
 * this test is where it should be caught.
 */
describe('with no app installed', () => {
  it('does not touch the network for anything bridge-related', async () => {
    const spy = stubFetch(() => json(HELLO));

    expect(await loadPairing()).toBeUndefined();
    expect(await probeBridge()).toEqual({ paired: false, reachable: false });
    await forgetPairing();

    expect(spy).not.toHaveBeenCalled();
  });
});
