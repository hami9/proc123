/**
 * Microdata — the same schema.org vocabulary, spelled in HTML attributes.
 *
 * The DOM is converted into schema.org-shaped JSON and then handed to exactly
 * the same mapper JSON-LD uses. Microdata is a different *notation* for the
 * same vocabulary, so treating it as a different data model would mean two
 * implementations of `offers` semantics and two chances to get them wrong.
 */

import {
  type CheerioAPI,
  type Element,
  attr,
  childElements,
  hasAttr,
  indexElementIds,
  tagName,
} from './html.js';
import type { JsonObject, JsonValue } from './json.js';
import { type SchemaScanContext, scanSchemaNodes } from './schema-product.js';
import {
  CONFIDENCE,
  type ExtractionIssue,
  type ExtractionOptions,
  type PageContext,
  type SourceReading,
} from './types.js';

/** Elements whose property value is the URL they point at. */
const SRC_ELEMENTS = new Set(['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video']);
const HREF_ELEMENTS = new Set(['a', 'area', 'link']);

/** Attributes a lazy-loading theme puts the real image URL in. */
const LAZY_IMAGE_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];

function firstFromSrcset(value: string): string | undefined {
  const first = value.split(',')[0]?.trim();
  const url = first?.split(/\s+/)[0];
  return url === undefined || url === '' ? undefined : url;
}

/**
 * The URL of an image element.
 *
 * `src` first, but a lazy-loading theme parks a 1x1 `data:` placeholder there
 * and keeps the real URL in a data attribute. Falling through to those is the
 * difference between exporting a catalogue with images and one without.
 */
function imageUrl(node: Element): string | undefined {
  const src = attr(node, 'src');
  if (src !== undefined && src !== '' && !/^data:/i.test(src)) return src;

  for (const name of LAZY_IMAGE_ATTRS) {
    const value = attr(node, name);
    if (value !== undefined && value !== '') return value;
  }

  for (const name of ['srcset', 'data-srcset']) {
    const value = attr(node, name);
    if (value !== undefined && value !== '') {
      const first = firstFromSrcset(value);
      if (first !== undefined) return first;
    }
  }

  return src;
}

/**
 * The value of one `itemprop` element.
 *
 * Per-element rules from the HTML microdata spec, with one deliberate
 * departure: a `content` attribute wins on *any* element, not just `<meta>`.
 * Themes routinely write `<span itemprop="price" content="1500">۱٬۵۰۰ تومان</span>`,
 * and the machine-readable half is the one that is safe to parse.
 */
function propertyValue($: CheerioAPI, node: Element, pageUrl: string): JsonValue {
  const content = attr(node, 'content');
  if (content !== undefined) return content;

  const tag = tagName(node);

  if (tag === 'img') {
    const url = imageUrl(node);
    return url === undefined ? '' : resolveAgainst(url, pageUrl);
  }
  if (SRC_ELEMENTS.has(tag)) {
    const src = attr(node, 'src');
    return src === undefined ? '' : resolveAgainst(src, pageUrl);
  }
  if (HREF_ELEMENTS.has(tag)) {
    const href = attr(node, 'href');
    return href === undefined ? '' : resolveAgainst(href, pageUrl);
  }
  if (tag === 'object') {
    const data = attr(node, 'data');
    return data === undefined ? '' : resolveAgainst(data, pageUrl);
  }
  if (tag === 'data' || tag === 'meter') {
    return attr(node, 'value') ?? $(node).text();
  }
  if (tag === 'time') {
    return attr(node, 'datetime') ?? $(node).text();
  }

  return $(node).text();
}

function resolveAgainst(value: string, pageUrl: string): string {
  try {
    return new URL(value.trim(), pageUrl).toString();
  } catch {
    return value;
  }
}

/**
 * The elements that supply an item's properties: descendants carrying
 * `itemprop`, not descending past an element that starts a nested item, plus
 * whatever `itemref` drags in from elsewhere in the document.
 */
function propertyElements(root: Element, ids: Map<string, Element>): Element[] {
  const found: Element[] = [];

  const visit = (parent: Element): void => {
    for (const child of childElements(parent)) {
      if (hasAttr(child, 'itemprop')) found.push(child);
      // An element with `itemscope` starts its own item; its properties belong
      // to that item, not this one.
      if (!hasAttr(child, 'itemscope')) visit(child);
    }
  };
  visit(root);

  const itemref = attr(root, 'itemref');
  if (itemref !== undefined) {
    for (const id of itemref.trim().split(/\s+/)) {
      const referenced = ids.get(id);
      if (referenced === undefined || referenced === root) continue;
      if (hasAttr(referenced, 'itemprop')) found.push(referenced);
      else visit(referenced);
    }
  }

  return found;
}

function addProperty(node: JsonObject, name: string, value: JsonValue): void {
  const existing = node[name];
  if (existing === undefined) {
    node[name] = value;
    return;
  }
  node[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
}

/** Depth guard: a malformed page can nest `itemscope` arbitrarily deep. */
const MAX_ITEM_DEPTH = 12;

function itemToJson(
  $: CheerioAPI,
  root: Element,
  pageUrl: string,
  ids: Map<string, Element>,
  depth = 0
): JsonObject {
  const node: JsonObject = {};

  const itemtype = attr(root, 'itemtype');
  if (itemtype !== undefined && itemtype.trim() !== '') {
    const types = itemtype.trim().split(/\s+/);
    node['@type'] = types.length === 1 ? (types[0] ?? '') : types;
  }

  const itemid = attr(root, 'itemid');
  if (itemid !== undefined && itemid.trim() !== '') node['@id'] = itemid.trim();

  if (depth >= MAX_ITEM_DEPTH) return node;

  for (const element of propertyElements(root, ids)) {
    const names = (attr(element, 'itemprop') ?? '').trim().split(/\s+/).filter(Boolean);
    if (names.length === 0) continue;

    const value = hasAttr(element, 'itemscope')
      ? itemToJson($, element, pageUrl, ids, depth + 1)
      : propertyValue($, element, pageUrl);

    for (const name of names) addProperty(node, name, value);
  }

  return node;
}

/**
 * Every top-level Microdata item on the page.
 *
 * "Top level" means no `itemprop` of its own — an element with both attributes
 * is a nested item and is reached through its parent.
 */
export function collectMicrodata($: CheerioAPI, pageUrl: string): JsonObject[] {
  const ids = indexElementIds($);
  const items: JsonObject[] = [];

  $('[itemscope]').each((_, element) => {
    if (hasAttr(element, 'itemprop')) return;
    items.push(itemToJson($, element, pageUrl, ids));
  });

  return items;
}

export function extractMicrodata(
  $: CheerioAPI,
  page: PageContext,
  options: ExtractionOptions = {}
): SourceReading {
  const issues: ExtractionIssue[] = [];

  const base: SchemaScanContext = {
    pageUrl: page.url,
    source: 'microdata',
    confidence: CONFIDENCE.microdata,
    derivedConfidence: CONFIDENCE.microdataDerived,
    weakConfidence: CONFIDENCE.weak,
    issues,
    ...(options.defaultCurrency !== undefined ? { defaultCurrency: options.defaultCurrency } : {}),
    ...(options.defaultCurrencyUnit !== undefined
      ? { defaultUnit: options.defaultCurrencyUnit }
      : {}),
  };

  const scan = scanSchemaNodes(collectMicrodata($, page.url), base);

  return {
    source: 'microdata',
    drafts: scan.drafts,
    discoveredUrls: scan.discoveredUrls,
    breadcrumb: scan.breadcrumb,
    issues,
  };
}
