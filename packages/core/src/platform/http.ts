/**
 * The HTTP seam.
 *
 * `core` never calls `fetch`. The extension supplies a client backed by the
 * background service worker (a content script on an HTTPS page cannot reach
 * `http://127.0.0.1`, and cross-origin reads belong to the worker anyway), the
 * companion supplies one backed by Node, and tests supply one backed by a map
 * of canned responses. CLAUDE.md §12: no live network in tests.
 *
 * A function type rather than an interface with one method, because the whole
 * contract is "give me a response" and a fake should be three lines.
 */

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  /** Header names are case-insensitive; clients should send them as given. */
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  /** Header names **must** be lowercased by the client. */
  headers: Record<string, string>;
  body: string;
  /** Final URL after redirects, where the client can report it. */
  url?: string;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export function header(response: HttpResponse, name: string): string | undefined {
  return response.headers[name.toLowerCase()];
}

/** A numeric header, or `undefined` when absent or not a number. */
export function headerNumber(response: HttpResponse, name: string): number | undefined {
  const raw = header(response, name);
  if (raw === undefined) return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

export function isJsonResponse(response: HttpResponse): boolean {
  const type = header(response, 'content-type');
  return type !== undefined && /\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(type);
}

/**
 * Parse a JSON body without throwing.
 *
 * A storefront that has disabled an endpoint answers with its 404 *page*, not a
 * JSON error — so "the body did not parse" is an ordinary, expected outcome
 * meaning "this endpoint is not available here", not a bug.
 */
export function parseJsonResponse(response: HttpResponse): unknown {
  if (response.body.trim() === '') return undefined;
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    return undefined;
  }
}

/** Build a URL with query parameters, skipping the ones that are unset. */
export function buildUrl(
  base: string,
  params: Readonly<Record<string, string | number | undefined>> = {}
): string {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(name, String(value));
  }
  return url.toString();
}
