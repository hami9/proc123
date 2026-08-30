/**
 * The bridge contract (CLAUDE.md §17).
 *
 * These are the assertions the phase asks for by name: the binding is loopback
 * and the token has the shape a per-run token has. They are cheap, and they are
 * the kind of property that is easy to weaken later by accident — a helper that
 * grows a `host` argument, a token check relaxed to "non-empty" — which is
 * exactly what a test is for.
 */

import { describe, expect, it } from 'vitest';

import {
  BRIDGE_HOST,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TOKEN_HEADER,
  buildBridgeUrl,
  formatPairingCode,
  isBridgeHello,
  isBridgeToken,
  parsePairingCode,
} from '@proc123/core';

const TOKEN = 'a'.repeat(32);

describe('buildBridgeUrl', () => {
  it('always names loopback', () => {
    expect(buildBridgeUrl(53_421, '/hello')).toBe('http://127.0.0.1:53421/bridge/hello');
    expect(BRIDGE_HOST).toBe('127.0.0.1');
  });

  it('takes a path with or without its slash', () => {
    expect(buildBridgeUrl(1, 'scan')).toBe(buildBridgeUrl(1, '/scan'));
  });

  it.each([0, -1, 65_536, 1.5, Number.NaN])('refuses %s as a port', (port) => {
    expect(() => buildBridgeUrl(port, '/hello')).toThrow(/usable port/);
  });

  /**
   * The point of the helper. A host parameter is how a loopback-only service
   * quietly becomes reachable elsewhere, so there is no way to supply one —
   * anything host-shaped in the path stays in the path.
   */
  it('cannot be redirected to another host through the path', () => {
    const url = buildBridgeUrl(4000, '//evil.example/steal');
    expect(new URL(url).hostname).toBe('127.0.0.1');
  });
});

describe('isBridgeToken', () => {
  it('accepts 32 lowercase hex characters', () => {
    expect(isBridgeToken(TOKEN)).toBe(true);
    expect(isBridgeToken('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['a'.repeat(31), 'too short'],
    ['a'.repeat(33), 'too long'],
    ['A'.repeat(32), 'uppercase'],
    ['g'.repeat(32), 'not hex'],
  ])('rejects %s (%s)', (value) => {
    expect(isBridgeToken(value)).toBe(false);
  });

  it('rejects things that are not strings', () => {
    expect(isBridgeToken(undefined)).toBe(false);
    expect(isBridgeToken(12345)).toBe(false);
  });
});

describe('pairing codes', () => {
  it('round-trips', () => {
    const code = formatPairingCode(53_421, TOKEN);
    expect(code).toBe(`53421-${TOKEN}`);
    expect(parsePairingCode(code)).toEqual({ port: 53_421, token: TOKEN });
  });

  it('tolerates the whitespace a paste brings with it', () => {
    expect(parsePairingCode(`  53421-${TOKEN}\n`)).toEqual({ port: 53_421, token: TOKEN });
  });

  it.each([
    ['', 'empty'],
    ['53421', 'no token'],
    [`-${TOKEN}`, 'no port'],
    [`0-${TOKEN}`, 'port zero'],
    [`70000-${TOKEN}`, 'port out of range'],
    ['53421-short', 'token too short'],
  ])('returns undefined for %s (%s)', (text) => {
    expect(parsePairingCode(text)).toBeUndefined();
  });

  it('refuses to format a token that is not one', () => {
    expect(() => formatPairingCode(53_421, 'nope')).toThrow(/bridge token/);
  });
});

describe('isBridgeHello', () => {
  const hello = {
    name: 'proc123',
    protocol: BRIDGE_PROTOCOL_VERSION,
    version: '1.10.0',
    platform: 'windows',
  };

  it('accepts the app answering', () => {
    expect(isBridgeHello(hello)).toBe(true);
  });

  /**
   * A different protocol number is not "close enough". The extension has to be
   * able to say "these two versions do not match" rather than fail later with
   * a shape error nobody can act on.
   */
  it('rejects another protocol version', () => {
    expect(isBridgeHello({ ...hello, protocol: BRIDGE_PROTOCOL_VERSION + 1 })).toBe(false);
  });

  it('rejects whatever else happens to be listening on that port', () => {
    expect(isBridgeHello({ name: 'something-else', protocol: BRIDGE_PROTOCOL_VERSION })).toBe(
      false
    );
    expect(isBridgeHello(null)).toBe(false);
    expect(isBridgeHello('proc123')).toBe(false);
  });
});

describe('the token header', () => {
  /**
   * Lowercase because `fetch` normalises header names, and a mismatch between
   * what the extension sends and what Rust compares would be invisible until
   * every request came back 401.
   */
  it('is lowercase, so both ends compare the same string', () => {
    expect(BRIDGE_TOKEN_HEADER).toBe(BRIDGE_TOKEN_HEADER.toLowerCase());
  });

  it('does not travel in the URL', () => {
    expect(buildBridgeUrl(4000, '/hello')).not.toContain(BRIDGE_TOKEN_HEADER);
  });
});
