/**
 * Trimming a page down to the subtree worth sending.
 *
 * CLAUDE.md §4: "Send a **trimmed DOM subtree**, never the whole page." Three
 * separate reasons, and the code has to serve all three:
 *
 * - **Cost.** Tokens are the user's money. A product page is mostly navigation,
 *   footer, cookie banner and inline script.
 * - **Accuracy.** Related-products carousels are the single biggest source of
 *   wrong answers: they contain real product names at real prices, and a model
 *   asked "what is the price" will happily read the neighbour's.
 * - **Disclosure.** Whatever is in the fragment is what leaves the user's
 *   machine. Sending less is a smaller disclosure, and `verify.ts` can only
 *   check answers against what was actually sent.
 *
 * The trim is deliberately conservative about *content* and aggressive about
 * *chrome*: it drops script, style and navigation wholesale, but never guesses
 * that a block of text is unimportant.
 */

import {
  type CheerioAPI,
  type Element,
  attr,
  isElement,
  isTextNode,
  loadHtml,
  tagName,
} from '../extract/html.js';

/**
 * Removed entirely, with their contents.
 *
 * `nav`, `header` and `footer` go because site chrome repeats on every page and
 * never describes the product. `form` stays: an add-to-cart form frequently
 * carries the variation table and the price a variable product resolves to.
 *
 * `nav` has one exception, in `isBreadcrumb` below — see there.
 */
const DROP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'template',
  'link',
  'nav',
  'header',
  'footer',
  'aside',
  'video',
  'audio',
  'source',
]);

/**
 * The one piece of navigation worth keeping.
 *
 * Categories are a Tier-1 field and one of the things that opens the Layer D
 * gate in the first place — and on most storefronts the only place a category
 * trail is written is a breadcrumb, which lives inside a `<nav>`. Dropping every
 * `nav` left the layer unable to answer the question that summoned it.
 *
 * So a `nav` survives when it is marked as a breadcrumb, by class, id, ARIA
 * label, or schema.org type. Everything else about `nav` is unchanged: a menu
 * is still chrome and still goes.
 */
function isBreadcrumb(node: Element): boolean {
  const marks = [
    attr(node, 'class'),
    attr(node, 'id'),
    attr(node, 'aria-label'),
    attr(node, 'itemtype'),
    attr(node, 'typeof'),
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ')
    .toLowerCase();
  return marks.includes('breadcrumb');
}

/**
 * Class and id fragments that mark a region as somebody else's product.
 *
 * Matched case-insensitively against `class` and `id`. Kept short and specific:
 * a false positive here silently deletes the answer, so `related` is listed but
 * `list` is not.
 */
const DROP_HINTS = [
  'related',
  'upsell',
  'cross-sell',
  'crosssell',
  'you-may-also',
  'also-like',
  'also-bought',
  'recently-viewed',
  'recently_viewed',
  'recent-view',
  'similar-product',
  // `breadcrumb` is deliberately absent: `isBreadcrumb` keeps those.
  'comment',
  'review-list',
  'newsletter',
  'cookie',
  'site-header',
  'site-footer',
  'menu-main',
  'mega-menu',
];

/**
 * Attributes worth keeping.
 *
 * `class` and `id` stay because they carry meaning a model can use ("price",
 * "قیمت", "stock") and because a learned Layer C profile is expressed in them.
 * Everything else — inline styles, event handlers, framework bookkeeping, the
 * long tail of `data-*` analytics ids — is noise measured in tokens.
 */
const KEEP_ATTRS = new Set([
  'class',
  'id',
  'itemprop',
  'itemtype',
  'itemscope',
  'href',
  'src',
  'alt',
  'title',
  'content',
  'datetime',
  'value',
  'lang',
  'dir',
]);

/** `data-*` names that carry values often absent from the rendered text. */
const KEEP_DATA =
  /^data-(?:price|regular|sale|product|sku|stock|qty|quantity|value|src|image|currency|attribute|variation|id)/i;

/**
 * Where a product page's own content usually starts, best first.
 *
 * Tried in order; the first selector that matches a single element wins. When
 * none match, the whole `body` is trimmed instead — a fragment of the wrong
 * shape is recoverable, an empty one is not.
 */
const ROOT_SELECTORS = [
  '[itemscope][itemtype*="schema.org/Product" i]',
  '[itemscope][itemtype*="Product" i]',
  '.product-single',
  '.single-product',
  '#product',
  '.product-detail',
  '.product-details',
  '.product-page',
  'main',
  '[role="main"]',
  'article',
  '#content',
  '.content',
];

export interface TrimOptions {
  /**
   * Hard ceiling on the returned string, in characters.
   *
   * Characters rather than tokens because the trimmer cannot tokenise for three
   * different vendors. Roughly four characters per token is the usual rule of
   * thumb, so the 24k default is on the order of 6k tokens — enough for a dense
   * product page, small enough that a runaway page cannot cost a fortune.
   */
  maxChars?: number;
  /** Element count ceiling, applied before the character ceiling. */
  maxElements?: number;
}

const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_ELEMENTS = 1_500;

export interface TrimmedFragment {
  html: string;
  /** The selector that picked the root, for the audit trail. */
  root: string;
  /** True when a ceiling cut the fragment short. */
  truncated: boolean;
  /** Characters of input, for a "we sent 3% of the page" line in the report. */
  sourceChars: number;
}

function hintMatches(node: Element): boolean {
  const haystack = `${attr(node, 'class') ?? ''} ${attr(node, 'id') ?? ''}`.toLowerCase();
  if (haystack.trim() === '') return false;
  return DROP_HINTS.some((hint) => haystack.includes(hint));
}

function keepAttribute(name: string): boolean {
  return KEEP_ATTRS.has(name) || KEEP_DATA.test(name);
}

/**
 * Rebuild one element as text.
 *
 * Serialising by hand rather than mutating the parsed tree and asking cheerio
 * for `.html()`: the output is a strict subset of tags and attributes chosen
 * here, so nothing unexpected — an inline `onclick`, a base64 `src` — can
 * survive into the payload by having been missed.
 */
function serialize(
  node: Element,
  budget: { elements: number; chars: number },
  out: string[]
): void {
  if (budget.elements <= 0 || budget.chars <= 0) return;

  const tag = tagName(node);
  if (DROP_TAGS.has(tag) && !(tag === 'nav' && isBreadcrumb(node))) return;
  if (hintMatches(node)) return;
  budget.elements -= 1;

  const attrs: string[] = [];
  for (const [name, value] of Object.entries(node.attribs)) {
    if (!keepAttribute(name.toLowerCase())) continue;
    if (value === '') {
      attrs.push(` ${name}`);
      continue;
    }
    // Long class lists are common in utility-first themes and are pure cost;
    // the first few are the semantic ones in every theme worth naming.
    const trimmed =
      name.toLowerCase() === 'class' ? value.split(/\s+/).slice(0, 8).join(' ') : value;
    attrs.push(` ${name}="${trimmed.replace(/"/g, '&quot;')}"`);
  }

  const open = `<${tag}${attrs.join('')}>`;
  out.push(open);
  budget.chars -= open.length;

  for (const child of node.children) {
    if (budget.chars <= 0) break;
    if (isTextNode(child)) {
      const text = child.data.replace(/\s+/g, ' ');
      if (text.trim() === '') continue;
      const clipped = text.length > budget.chars ? text.slice(0, Math.max(0, budget.chars)) : text;
      out.push(clipped);
      budget.chars -= clipped.length;
      continue;
    }
    // `isElement` is domhandler's `isTag`, which also covers script and style
    // nodes — `DROP_TAGS` is what rejects those, one line into the recursion.
    if (isElement(child)) serialize(child, budget, out);
  }

  const close = `</${tag}>`;
  out.push(close);
  budget.chars -= close.length;
}

function pickRoot($: CheerioAPI): { node: Element; selector: string } | undefined {
  for (const selector of ROOT_SELECTORS) {
    const found = $(selector).first();
    const node = found.get(0);
    if (node !== undefined && isElement(node)) return { node, selector };
  }
  const body = $('body').get(0);
  if (body !== undefined && isElement(body)) return { node: body, selector: 'body' };
  return undefined;
}

/** True when `node` is `ancestor` or sits somewhere beneath it. */
function isWithin(node: Element, ancestor: Element): boolean {
  let current: Element | null = node;
  while (current !== null) {
    if (current === ancestor) return true;
    const parent: unknown = current.parent;
    current =
      parent !== null && parent !== undefined && isElement(parent as Element)
        ? (parent as Element)
        : null;
  }
  return false;
}

/**
 * Selectors for the category trail, tried in order.
 *
 * Looked up across the whole document rather than inside the chosen root,
 * because the roots that give the cleanest fragment — `.product-detail`, an
 * `itemscope` Product node — are exactly the ones that sit *below* the
 * breadcrumb. Picking a wider root to catch it would drag the related-products
 * carousel back in, which is a worse trade: a wrong price is worse than a
 * missing category.
 */
const BREADCRUMB_SELECTORS = [
  '[itemtype*="BreadcrumbList" i]',
  'nav[class*="breadcrumb" i]',
  'nav[aria-label*="breadcrumb" i]',
  '[class*="breadcrumb" i]',
  '[id*="breadcrumb" i]',
];

function findBreadcrumb($: CheerioAPI, root: Element): Element | undefined {
  for (const selector of BREADCRUMB_SELECTORS) {
    const node = $(selector).first().get(0);
    if (node === undefined || !isElement(node)) continue;
    // Already inside the fragment; serialising it twice would just cost tokens.
    if (isWithin(node, root)) return undefined;
    return node;
  }
  return undefined;
}

/**
 * Reduce a page to the subtree Layer D is allowed to send.
 *
 * Never throws: a page that will not parse yields an empty fragment, and an
 * empty fragment means Layer D does not run — which is the right outcome, since
 * there would be nothing to check an answer against.
 */
export function trimFragment(html: string, options: TrimOptions = {}): TrimmedFragment {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const sourceChars = html.length;

  let $: CheerioAPI;
  try {
    $ = loadHtml(html);
  } catch {
    return { html: '', root: 'none', truncated: false, sourceChars };
  }

  const root = pickRoot($);
  if (root === undefined) return { html: '', root: 'none', truncated: false, sourceChars };

  const budget = { elements: maxElements, chars: maxChars };
  const out: string[] = [];

  // The breadcrumb goes first, so the trail reads as context for what follows.
  const breadcrumb = findBreadcrumb($, root.node);
  if (breadcrumb !== undefined) serialize(breadcrumb, budget, out);

  serialize(root.node, budget, out);

  return {
    html: out
      .join('')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    root: root.selector,
    truncated: budget.chars <= 0 || budget.elements <= 0,
    sourceChars,
  };
}

/** Exported for tests and for the "what did we send?" line in the report. */
export const FRAGMENT_LIMITS = {
  maxChars: DEFAULT_MAX_CHARS,
  maxElements: DEFAULT_MAX_ELEMENTS,
} as const;
