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
