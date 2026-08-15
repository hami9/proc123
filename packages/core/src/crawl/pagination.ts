/**
 * Finding the next page.
 *
 * CLAUDE.md §10: "Pagination strategies: numbered links, 'load more' buttons,
 * infinite scroll, `?page=` URL patterns. Detect which applies; don't assume
 * one." Assuming one is how a scanner silently returns the first twenty-four
 * products of a two-hundred-product category and calls it done.
 *
 * Two of the four strategies are URLs and two are interactions. A URL can be
 * followed from anywhere; a "load more" button needs a live browser to click.
 * This module says which it found and whether it can be followed without one,
 * so the caller can hand the interactive cases to the extension instead of
 * pretending the category ended.
 *
 * Next pages are followed link by link rather than by guessing a URL template.
 * A template built from `/category/2024/page/2/` has two numbers to choose
 * between and picking wrong produces a scan of the wrong category.
 */

import type { CheerioAPI } from '../extract/html.js';
import { cleanText, foldForCompare } from '../text.js';
import { canonicalizeUrl, resolveUrl } from '../url.js';
import type { PageContext } from '../extract/types.js';

export type PaginationStrategy =
  /** `<link rel="next">` or `<a rel="next">`. The most reliable signal there is. */
  | 'rel-next'
  /** A numbered pagination nav; the link one past the current page is followed. */
  | 'numbered'
  /** A "load more" button, usually backed by a URL in a data attribute. */
  | 'load-more'
  /** Products appended on scroll. Needs a live browser unless a URL leaks out. */
  | 'infinite-scroll'
  /** Nothing found: this is the only page. */
  | 'none';

export interface PaginationPlan {
  strategy: PaginationStrategy;
  /**
   * True when the next page can be fetched as a URL. False means a live
   * browser has to drive it, and the caller should say so rather than stop
   * silently.
   */
  automatable: boolean;
  /** The next page, absolute and canonicalized. */
  nextUrl?: string;
  /** The highest page number the page advertises, when it advertises one. */
  lastPage?: number;
  /** Which page this is, when it says. */
  currentPage?: number;
  /** What fired, for the troubleshooting report. */
  signals: string[];
}

/** Query parameters that hold a page number, most specific first. */
const PAGE_PARAMS = ['page', 'paged', 'p', 'pg', 'offset_page', 'product-page'];

/** Path forms that hold a page number: `/page/2/`, `/pagina/2/`, `/صفحه/2/`. */
const PAGE_SEGMENTS = ['page', 'pagina', 'seite', 'صفحه'];

/** Text on a "load more" control, in the languages this project cares about. */
const LOAD_MORE_WORDS = [
  'load more',
  'show more',
  'view more',
  'see more',
  'more products',
  'نمایش بیشتر',
  'بیشتر',
  'مشاهده بیشتر',
  'محصولات بیشتر',
];

/** Attributes a theme parks the next-page URL in. */
const URL_ATTRS = [
  'data-url',
  'data-href',
  'data-next',
  'data-next-url',
  'data-next-page-url',
  'data-load-more-url',
  'data-ajax-url',
];

/** Attributes a theme parks the next-page *number* in. */
const PAGE_ATTRS = ['data-page', 'data-next-page', 'data-paged', 'data-current-page'];

/** Read a page number out of a URL, from either a query parameter or a path segment. */
export function pageNumberFromUrl(url: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  for (const name of PAGE_PARAMS) {
    const value = parsed.searchParams.get(name);
    if (value !== null && /^\d+$/.test(value)) return Number(value);
  }

  const segments = decodeURIComponent(parsed.pathname)
    .split('/')
    .filter((segment) => segment !== '');

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = (segments[i] ?? '').toLowerCase();
    const next = segments[i + 1] ?? '';
    if (PAGE_SEGMENTS.includes(segment) && /^\d+$/.test(next)) return Number(next);
  }

  return undefined;
}

function absolute(href: string | undefined, base: string): string | undefined {
  if (href === undefined || href.trim() === '') return undefined;
  const resolved = resolveUrl(href, base);
  if (resolved === undefined || !/^https?:/i.test(resolved)) return undefined;
  return canonicalizeUrl(resolved);
}

interface NumberedLink {
  url: string;
  page: number;
}

/**
 * Every numbered link in the page's pagination navs.
 *
 * The number is taken from the link's URL rather than its text: a theme that
 * renders `»` or `آخرین` still carries the number in the href, and a link whose
 * text is a number but whose URL is not a page link is not pagination.
 */
function numberedLinks($: CheerioAPI, base: string): NumberedLink[] {
  const found = new Map<number, string>();

  $(
    '.page-numbers a, a.page-numbers, .pagination a, .pagination__item a, nav[class*="pagin"] a, ul[class*="pagin"] a, [class*="pagination"] a'
  ).each((_, element) => {
    const url = absolute($(element).attr('href'), base);
    if (url === undefined) return;

    const page = pageNumberFromUrl(url);
    if (page === undefined || found.has(page)) return;
    found.set(page, url);
  });

  return [...found].map(([page, url]) => ({ page, url })).sort((a, b) => a.page - b.page);
}

function looksLikeLoadMore($: CheerioAPI): { element: string; signal: string } | undefined {
  const explicit = $(
    '[data-load-more], .load-more, .loadmore, [class*="load-more"], [class*="loadmore"]'
  ).first();
  if (explicit.length > 0) return { element: 'load-more class', signal: 'load-more control' };

  let match: { element: string; signal: string } | undefined;
  $('button, a[role="button"], a.button').each((_, element) => {
    if (match !== undefined) return;
    const text = foldForCompare(cleanText($(element).text()));
    if (text === '') return;
    if (LOAD_MORE_WORDS.some((word) => text.includes(foldForCompare(word)))) {
      match = {
        element: 'button text',
        signal: `control labelled "${cleanText($(element).text())}"`,
      };
    }
  });
  return match;
}

function looksLikeInfiniteScroll($: CheerioAPI, html: string): string | undefined {
  if ($('[data-infinite-scroll], .infinite-scroll, [class*="infinite-scroll"]').length > 0) {
    return 'infinite-scroll markup';
  }
  const lower = html.toLowerCase();
  for (const marker of ['infinitescroll', 'infinite_scroll', 'jscroll', 'data-auto-load']) {
    if (lower.includes(marker)) return `${marker} in page scripts`;
  }
  return undefined;
}

/**
 * Work out how this page continues.
 *
 * Order matters: `rel="next"` is what the page itself says, so it outranks a
 * nav we had to interpret, which outranks a button we had to read the label of.
 */
export function detectPagination($: CheerioAPI, page: PageContext): PaginationPlan {
  const signals: string[] = [];
  const currentPage = pageNumberFromUrl(page.url) ?? 1;

  const links = numberedLinks($, page.url);
  const lastPage = links.length > 0 ? Math.max(...links.map((link) => link.page)) : undefined;

  const plan = (
    extra: Partial<PaginationPlan> & { strategy: PaginationStrategy }
  ): PaginationPlan => ({
    automatable: extra.nextUrl !== undefined,
    signals,
    currentPage,
    ...(lastPage === undefined ? {} : { lastPage }),
    ...extra,
  });

  // 1. The page states its own successor.
  const relNext =
    absolute($('link[rel="next"]').attr('href'), page.url) ??
    absolute($('a[rel~="next"]').attr('href'), page.url);
  if (relNext !== undefined && canonicalizeUrl(page.url) !== relNext) {
    signals.push('rel="next" link');
    return plan({ strategy: 'rel-next', nextUrl: relNext });
  }

  // 2. A numbered nav: take the link one past where we are.
  const following = links.find((link) => link.page === currentPage + 1);
  if (following !== undefined) {
    signals.push(`numbered pagination, page ${String(currentPage)} of ${String(lastPage ?? '?')}`);
    return plan({ strategy: 'numbered', nextUrl: following.url });
  }

  // A nav with no link past the current page means this is the last page —
  // which is an answer, not a failure to find one.
  if (links.length > 0 && lastPage !== undefined && currentPage >= lastPage) {
    signals.push(`numbered pagination exhausted at page ${String(lastPage)}`);
    return plan({ strategy: 'none' });
  }

  // 3. A "load more" control. Often a URL in a data attribute, in which case it
  //    can be followed like any other; otherwise it needs a real click.
  const loadMore = looksLikeLoadMore($);
  if (loadMore !== undefined) {
    signals.push(loadMore.signal);
    const container = $(
      '[data-load-more], .load-more, .loadmore, [class*="load-more"], [class*="loadmore"], button, a.button'
    );

    let nextUrl: string | undefined;
    let nextPage: number | undefined;
    container.each((_, element) => {
      if (nextUrl !== undefined) return;
      for (const attribute of URL_ATTRS) {
        const candidate = absolute($(element).attr(attribute), page.url);
        if (candidate !== undefined) {
          nextUrl = candidate;
          signals.push(`next page URL in ${attribute}`);
          return;
        }
      }
      for (const attribute of PAGE_ATTRS) {
        const raw = $(element).attr(attribute);
        if (raw !== undefined && /^\d+$/.test(raw.trim())) nextPage ??= Number(raw.trim());
      }
    });

    if (nextUrl === undefined && nextPage !== undefined && nextPage > currentPage) {
      const candidate = links.find((link) => link.page === nextPage);
      if (candidate !== undefined) nextUrl = candidate.url;
    }

    return plan(
      nextUrl === undefined ? { strategy: 'load-more' } : { strategy: 'load-more', nextUrl }
    );
  }

  // 4. Infinite scroll with no URL to follow. Honest answer: needs a browser.
  const infinite = looksLikeInfiniteScroll($, page.html);
  if (infinite !== undefined) {
    signals.push(infinite);
    return plan({ strategy: 'infinite-scroll' });
  }

  return plan({ strategy: 'none' });
}
