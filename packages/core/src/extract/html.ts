/**
 * HTML parsing for the extraction pipeline.
 *
 * `cheerio/slim` rather than `cheerio`: the full entry point pulls in `undici`
 * and `node:stream` for its fetch helpers, which cannot be bundled into an MV3
 * content script. The slim entry is htmlparser2-only and runs unchanged in the
 * browser, in the companion, and in tests — the same parse everywhere means a
 * fixture that passes here behaves the same on a real page.
 */

import { type CheerioAPI, load } from 'cheerio/slim';
import { type AnyNode, type Element, type Text, isTag, isText } from 'domhandler';

export type { CheerioAPI, AnyNode, Element, Text };

export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

/** True for tag, `<script>` and `<style>` nodes; false for text and comments. */
export function isElement(node: AnyNode): node is Element {
  return isTag(node);
}

/** True for text nodes. Comments and CDATA are not text for our purposes. */
export function isTextNode(node: AnyNode): node is Text {
  return isText(node);
}

/** Element children only, skipping text and comment nodes. */
export function childElements(node: Element): Element[] {
  return node.children.filter(isElement);
}

export function attr(node: Element, name: string): string | undefined {
  const value = node.attribs[name];
  return value === undefined ? undefined : value;
}

export function hasAttr(node: Element, name: string): boolean {
  return node.attribs[name] !== undefined;
}

export function tagName(node: Element): string {
  return node.tagName.toLowerCase();
}

/** Index every element carrying an `id`, for Microdata's `itemref`. */
export function indexElementIds($: CheerioAPI): Map<string, Element> {
  const index = new Map<string, Element>();
  $('[id]').each((_, node) => {
    const id = attr(node, 'id');
    if (id !== undefined && id !== '' && !index.has(id)) index.set(id, node);
  });
  return index;
}

/**
 * Attributes a lazy-loading theme parks the real image URL in.
 *
 * Ordered by how commonly they carry the full-size image rather than another
 * placeholder. Srcset-valued attributes are listed separately below, because
 * their value is a list rather than a single URL.
 *
 * These two lists are the one place the names live. The inspector (§16) reads
 * the same attributes for a different purpose — it wants every URL an element
 * references, not the first usable one — but a theme's choice of attribute does
 * not change with who is asking, so it imports the names from here.
 */
export const LAZY_IMAGE_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];

/** Attributes holding a `srcset`-shaped list, lazy variants included. */
export const SRCSET_ATTRS = ['srcset', 'data-srcset', 'data-lazy-srcset'];

/** The first URL in a `srcset`, dropping its width or density descriptor. */
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
 *
 * Every layer that reads an `<img>` goes through here. A theme does not lazy-load
 * differently depending on whether the page also published JSON-LD, so a layer
 * that read `src` on its own would be the only one returning placeholders.
 */
export function readImageUrl(node: Element): string | undefined {
  const src = attr(node, 'src');
  if (src !== undefined && src !== '' && !/^data:/i.test(src)) return src;

  for (const name of LAZY_IMAGE_ATTRS) {
    const value = attr(node, name);
    if (value !== undefined && value !== '') return value;
  }

  for (const name of SRCSET_ATTRS) {
    const value = attr(node, name);
    if (value !== undefined && value !== '') {
      const first = firstFromSrcset(value);
      if (first !== undefined) return first;
    }
  }

  return src;
}
