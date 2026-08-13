/**
 * URL canonicalization.
 *
 * Two jobs, both of which need the *same* answer for the same product page:
 * de-duplicating products found through pagination and infinite scroll
 * (CLAUDE.md §10), and generating deterministic SKUs so that re-scanning a
 * catalogue updates rows instead of duplicating them (§7.3).
 */

const TRACKING_PARAM_PREFIXES = ['utm_', 'pk_', 'mtm_', 'matomo_'];

const TRACKING_PARAMS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref',
  'ref_src',
  'referrer',
  'source',
  'spm',
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Normalize a product URL so cosmetic differences stop producing duplicates.
 *
 * Lowercases the scheme and host, drops the fragment and default port, removes
 * campaign/tracking parameters, sorts what remains, and drops a trailing slash
 * on non-root paths. Deliberately conservative: `www.` is kept, because on some
 * stores it is genuinely a different host.
 *
 * Input that is not a parseable absolute URL is returned trimmed, so callers
 * still get a stable key for it.
 */
export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  const kept = [...url.searchParams.entries()].filter(([name]) => !isTrackingParam(name));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  url.search = '';
  for (const [name, value] of kept) {
    url.searchParams.append(name, value);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

/** Resolve a possibly-relative URL found in markup against the page it came from. */
export function resolveUrl(href: string, baseUrl: string): string | undefined {
  try {
    return new URL(href.trim(), baseUrl).toString();
  } catch {
    return undefined;
  }
}
