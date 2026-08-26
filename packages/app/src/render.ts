/**
 * Reading a page the way a browser would.
 *
 * A shop that builds its product grid in JavaScript ships an empty shell to
 * anything that only reads HTML. The CLI has always failed on those; the
 * extension never does, because it lives inside a browser that already
 * rendered the page. This is how the app gets the same answer (CLAUDE.md §15).
 *
 * Two calls, mirroring `src-tauri/src/render.rs`. `renderedHtml` is what a scan
 * needs. `evaluate` is what phase 27 needs to read Core Web Vitals out of the
 * Performance API — it is here now because adding it later means reopening the
 * window plumbing rather than writing one more command.
 */

interface TauriGlobal {
  core?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
}

/** Mirrors `RenderedPage` in `src-tauri/src/render.rs`. */
interface NativeRender {
  url: string;
  /** JSON, because that is what the WebView's eval callback hands back. */
  result: string;
}

export interface RenderedPage {
  /** The URL the window ended on, after any client-side redirect. */
  url: string;
  html: string;
}

function invoker(): <T>(command: string, args?: Record<string, unknown>) => Promise<T> {
  const tauri = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (invoke === undefined) {
    throw new Error(
      'This build is running without its native host, so it cannot render pages. ' +
        'Open the app itself rather than the front end in a browser.'
    );
  }
  return invoke;
}

/** True when rendering is possible at all — the extension and a plain browser cannot. */
export function canRender(): boolean {
  const tauri = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return typeof tauri?.core?.invoke === 'function';
}

/**
 * The value the WebView returned, unwrapped.
 *
 * `eval_with_callback` serialises whatever the script evaluated to, so a string
 * arrives JSON-quoted. A page that returns something unparseable is reported as
 * having returned nothing rather than as a crash — a hostile or half-loaded
 * page is an ordinary outcome here, not an exception.
 */
function unwrap(result: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(result);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load a URL in a real WebView and return the DOM once it has settled.
 *
 * **This is a request to somebody's server** — and a heavier one than a plain
 * fetch, because the page pulls all of its own subresources too. §10 does not
 * stop applying because the request came from a WebView, so callers pace this
 * exactly as they pace an ordinary fetch.
 */
export async function renderPage(url: string): Promise<RenderedPage> {
  const native = await invoker()<NativeRender>('rendered_html', { url });
  const html = unwrap(native.result);

  if (html === undefined || html.trim() === '') {
    throw new Error(`${url} rendered but returned no markup.`);
  }
  return { url: native.url, html };
}

/**
 * Run a script in a rendered page and return its value as parsed JSON.
 *
 * A read, never a write: §16 says the inspector does not modify the page it is
 * looking at, and a script that did would be a defect rather than a feature.
 */
export async function evaluateInPage<T>(url: string, script: string): Promise<T | undefined> {
  const native = await invoker()<NativeRender>('evaluate', { url, script });
  try {
    return JSON.parse(native.result) as T;
  } catch {
    return undefined;
  }
}
