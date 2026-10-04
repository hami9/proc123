import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedUrl, watchSharedUrls } from '../src/share.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared URLs', () => {
  it.each([
    ['https://shop.example/c/', 'https://shop.example/c/'],
    [
      'Almonds\nhttps://shop.example/c/?page=2&sort=price',
      'https://shop.example/c/?page=2&sort=price',
    ],
    ['فروشگاه\nHTTP://SHOP.EXAMPLE/c/#nuts', 'http://shop.example/c/#nuts'],
  ])('reads a browser share: %s', (text, expected) => {
    expect(sharedUrl(text)).toBe(expected);
  });

  it.each([
    null,
    {},
    '',
    'javascript:alert(1)',
    'file:///sdcard/private.csv',
    'content://documents/1',
    'https://',
    'https://user:password@shop.example/',
    'https://shop.example/ https://other.example/',
    'x'.repeat(8193),
  ])('rejects unsupported or ambiguous input: %s', (text) => {
    expect(sharedUrl(text)).toBeUndefined();
  });
});

describe('the share inbox', () => {
  it('consumes a cold-start share only after the UI is ready', async () => {
    vi.useFakeTimers();
    let ready = false;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ text: 'https://shop.example/c/' })
      .mockResolvedValue({ text: null });
    const receive = vi.fn().mockResolvedValue(undefined);
    const stop = watchSharedUrls({
      invoke,
      receive,
      ready: () => ready,
      invalid: vi.fn(),
      failed: vi.fn(),
    });
    expect(invoke).not.toHaveBeenCalled();
    ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(receive).toHaveBeenCalledWith('https://shop.example/c/');
    await vi.advanceTimersByTimeAsync(500);
    expect(receive).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps warm shares queued during a scan and never overlaps scans', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const scan = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const invoke = vi.fn().mockResolvedValue({ text: 'https://shop.example/c/' });
    const receive = vi.fn().mockReturnValue(scan);
    const stop = watchSharedUrls({
      invoke,
      receive,
      ready: () => true,
      invalid: vi.fn(),
      failed: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledTimes(1);
    stop();
    finish?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports bad shares without starting a scan', async () => {
    vi.useFakeTimers();
    const receive = vi.fn().mockResolvedValue(undefined);
    const invalid = vi.fn();
    const stop = watchSharedUrls({
      invoke: vi.fn().mockResolvedValue({ text: 'not a URL' }),
      receive,
      invalid,
      ready: () => true,
      failed: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(invalid).toHaveBeenCalledTimes(1);
    expect(receive).not.toHaveBeenCalled();
    stop();
  });

  it('retains a share if a manual scan starts while native IPC is in flight', async () => {
    vi.useFakeTimers();
    let ready = true;
    let deliver: ((result: { text: string }) => void) | undefined;
    const reply = new Promise<{ text: string }>((resolve) => {
      deliver = resolve;
    });
    const invoke = vi.fn().mockReturnValueOnce(reply).mockResolvedValue({ text: null });
    const receive = vi.fn().mockResolvedValue(undefined);
    const stop = watchSharedUrls({
      invoke,
      receive,
      ready: () => ready,
      invalid: vi.fn(),
      failed: vi.fn(),
    });
    ready = false;
    deliver?.({ text: 'https://shop.example/c/' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(receive).not.toHaveBeenCalled();
    ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(receive).toHaveBeenCalledWith('https://shop.example/c/');
    expect(invoke).toHaveBeenCalledTimes(1);
    stop();
  });

  it('is a no-op in a plain browser', () => {
    vi.stubGlobal('__TAURI__', undefined);
    const receive = vi.fn();
    const stop = watchSharedUrls({ receive, ready: () => true, invalid: vi.fn(), failed: vi.fn() });
    stop();
    expect(receive).not.toHaveBeenCalled();
  });

  it('reports native failure once and leaves manual scans available', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn().mockRejectedValue(new Error('missing plugin'));
    const failed = vi.fn();
    watchSharedUrls({ invoke, failed, ready: () => true, receive: vi.fn(), invalid: vi.fn() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
