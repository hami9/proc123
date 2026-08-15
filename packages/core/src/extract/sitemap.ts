/**
 * `sitemap.xml` parsing, for product URL discovery.
 *
 * Layer B's other half: structured markup says what a product *is*, a sitemap
 * says which products *exist*. Stores that paginate with infinite scroll often
 * publish a complete sitemap, which is a far politer way to enumerate a
 * catalogue than walking every listing page (CLAUDE.md §10).
 *
 * Fetching is deliberately not done here — the extension and the companion own
 * the network, including the delay between requests.
 */

import { load } from 'cheerio/slim';
import { cleanText } from '../text.js';
import { resolveUrl } from '../url.js';
import type { ExtractionIssue } from './types.js';

export interface SitemapEntry {
  loc: string;
  /** W3C datetime, as published. Useful for skipping unchanged products. */
  lastmod?: string;
}

export interface SitemapReading {
  /** Page URLs from a `<urlset>`. */
  urls: SitemapEntry[];
  /** Nested sitemap URLs from a `<sitemapindex>`, to be fetched in turn. */
  sitemaps: string[];
  issues: ExtractionIssue[];
}

function absolute(raw: string, baseUrl: string | undefined): string | undefined {
  const text = cleanText(raw);
  if (text === '') return undefined;

  const resolved = baseUrl === undefined ? text : (resolveUrl(text, baseUrl) ?? text);
  return /^https?:/i.test(resolved) ? resolved : undefined;
}

/**
 * Parse a sitemap or a sitemap index.
 *
 * Both shapes are handled in one pass because a store's `/sitemap.xml` is
 * whichever of the two it feels like, and callers should not have to guess
 * before parsing.
 */
export function parseSitemap(xml: string, baseUrl?: string): SitemapReading {
  const issues: ExtractionIssue[] = [];
  const urls: SitemapEntry[] = [];
  const sitemaps: string[] = [];

  // htmlparser2 recovers from anything rather than throwing, so there is no
  // parse error to catch: input that is not a sitemap simply yields no entries,
  // which the emptiness check below reports.
  const $ = load(xml, { xml: true });
  const seen = new Set<string>();

  $('url').each((_, element) => {
    const loc = absolute($(element).children('loc').first().text(), baseUrl);
    if (loc === undefined || seen.has(loc)) return;
    seen.add(loc);

    const lastmod = cleanText($(element).children('lastmod').first().text());
    urls.push(lastmod === '' ? { loc } : { loc, lastmod });
  });

  $('sitemap').each((_, element) => {
    const loc = absolute($(element).children('loc').first().text(), baseUrl);
    if (loc === undefined || sitemaps.includes(loc)) return;
    sitemaps.push(loc);
  });

  if (urls.length === 0 && sitemaps.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'sitemap-empty',
      message:
        'The sitemap held no <url> or <sitemap> entries. It may be gzipped, or the ' +
        'store may have returned an error page in its place.',
    });
  }

  return { urls, sitemaps, issues };
}

/**
 * Narrow a sitemap down to the URLs likely to be products.
 *
 * A hint is a path fragment such as `/product/` or `/محصول/`. Matching is done
 * on the decoded path so percent-encoded non-Latin slugs still match.
 */
export function filterSitemapUrls(
  entries: readonly SitemapEntry[],
  hints: readonly string[]
): SitemapEntry[] {
  if (hints.length === 0) return [...entries];

  const needles = hints.map((hint) => hint.toLowerCase());

  return entries.filter((entry) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(entry.loc).pathname).toLowerCase();
    } catch {
      path = entry.loc.toLowerCase();
    }
    return needles.some((needle) => path.includes(needle));
  });
}
