/** Android shares enter the ordinary scan path, never a second crawler. */
type Invoke = <T>(command: string) => Promise<T>;

/** Accept exactly one HTTP(S) URL, optionally alongside a browser's title. */
export function sharedUrl(text: unknown): string | undefined {
  if (typeof text !== 'string' || text.length > 8192) return undefined;
  const matches = text.match(/https?:\/\/[^\s<>"`]+/gi);
  if (matches?.length !== 1) return undefined;
  try {
    const url = new URL(matches[0] ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export interface ShareOptions {
  ready: () => boolean;
  receive: (url: string) => Promise<void>;
  invalid: () => void;
  failed: () => void;
  /** Test seam; production calls the app's own native command. */
  invoke?: Invoke;
}

/** Pull after UI setup; native events emitted during cold startup can be lost. */
export function watchSharedUrls(options: ShareOptions): () => void {
  const native = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__;
  const invoke = options.invoke ?? native?.core?.invoke;
  if (invoke === undefined) return () => undefined;
  const call: Invoke = invoke;
  let stopped = false;
  let pending: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll(): Promise<void> {
    try {
      // Keep the native queue intact while a scan/export is running or the app
      // is in the background. Only one poll and one scan may run at a time.
      if (!stopped && options.ready()) {
        if (pending === undefined) {
          const result = await call<{ text?: unknown }>('take_shared_text');
          pending = result.text ?? undefined;
        }
        if (stopped) return;
        // A manual scan can start while IPC is in flight. Retain the share
        // until that scan finishes instead of changing its URL or losing it.
        if (pending !== undefined && options.ready()) {
          const url = sharedUrl(pending);
          pending = undefined;
          if (url === undefined) options.invalid();
          else await options.receive(url);
        }
      }
    } catch {
      // A broken native integration is not a failed shop scan. Stop polling
      // and let the user paste a URL; never log shared text or credentials.
      stopped = true;
      options.failed();
    }
    if (!stopped)
      timer = setTimeout(() => {
        void poll();
      }, 500);
  }

  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
