/**
 * Turning a click into a selector that will still work next month.
 *
 * CLAUDE.md §4 Layer C: "prefer structural/attribute-based selectors over long
 * brittle `nth-child` chains". The reason is concrete — a profile is saved once
 * and used for months, and the two things that change underneath it are the
 * *order* of elements (a badge is added, a wishlist button moves) and *generated*
 * class names (a build regenerates `css-1a2b3c`). A selector that leans on
 * either is a profile that breaks without anyone touching it.
 *
 * So candidates are scored by how much *meaning* they carry, not by how short
 * they are. `[itemprop="name"]` is the store telling us what the element is.
 * `.product-title` is a developer saying so. `.css-1a2b3c` is a build tool
 * saying nothing at all, and `:nth-child(3)` is us guessing.
 */

import { type Element, attr, childElements, tagName } from '../extract/html.js';

/** Words that mean the class was named after what the element *is*. */
const MEANINGFUL = [
  'product',
  'title',
  'name',
  'price',
  'amount',
  'image',
  'img',
  'thumb',
  'photo',
  'card',
  'item',
  'link',
  'sale',
  'regular',
  'sku',
  'stock',
  'availability',
  'brand',
  'loop',
  'grid',
  'tile',
];

/**
 * Class names a build tool generated.
 *
 * CSS Modules (`Button_root__2x3Yz`), styled-components (`sc-bdVaJa`), emotion
 * (`css-1a2b3c`), and the `post-4821` ids WordPress gives every row. All of
 * them change when the site is rebuilt or the product is re-saved.
 */
const GENERATED = [
  /^css-[a-z0-9]{4,}$/i,
  /^sc-[a-zA-Z0-9]{6,}$/,
  /^jsx-\d+$/,
  /^[A-Za-z]+_[A-Za-z]+__[A-Za-z0-9]{4,}$/,
  /^[a-z]+-\d{3,}$/i,
  /^_[a-zA-Z0-9]{5,}$/,
  /^[a-f0-9]{8,}$/i,
];

/**
 * Classes that are stable but say nothing about *this* element, because every
 * other element has them too. Kept as a last resort, never preferred.
 */
const UTILITY =
  /^(?:[mp][trblxy]?-\d|w-|h-|text-|bg-|flex|grid|block|inline|relative|absolute|hidden|clearfix|row|col(?:-|$)|d-|js-)/;

export function isGeneratedClass(name: string): boolean {
  return GENERATED.some((pattern) => pattern.test(name));
}

export function isUtilityClass(name: string): boolean {
  return UTILITY.test(name);
}

export function classesOf(element: Element): string[] {
  return (attr(element, 'class') ?? '')
    .split(/\s+/)
    .filter((name) => name !== '' && CSS_IDENT.test(name));
}

/**
 * Only classes that can be written into a selector without escaping.
 *
 * ASCII identifiers only, on purpose. A non-ASCII class name is vanishingly
 * rare and rejecting one costs nothing — another candidate is used instead —
 * whereas getting the escaping wrong produces a selector that matches nothing
 * and a profile that fails silently.
 */
const CSS_IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

/** Attributes worth selecting on, in the order they are worth it. */
const SEMANTIC_ATTRS = ['itemprop', 'data-product-title', 'data-testid', 'data-test', 'role'];

export interface Candidate {
  selector: string;
  /** Higher is more likely to survive. */
  score: number;
  /** Plain-words reason, written into the profile so a person can audit it. */
  reason: string;
}

/**
 * Everything worth trying for one element, best first.
 *
 * Nothing here is guaranteed to be unique — that is the caller's problem, and
 * combining two mediocre candidates is often better than falling back to
 * position.
 */
export function candidatesFor(element: Element): Candidate[] {
  const found: Candidate[] = [];
  const tag = tagName(element);

  for (const name of SEMANTIC_ATTRS) {
    const value = attr(element, name);
    if (value === undefined) continue;
    // A long value is content, not an identifier, and matching on it would tie
    // the profile to one particular product.
    if (value !== '' && value.length <= 40) {
      found.push({
        selector: `[${name}="${value.replace(/"/g, '\\"')}"]`,
        score: name === 'itemprop' ? 100 : 85,
        reason: `the markup labels this element ${name}="${value}"`,
      });
    } else if (value === '') {
      found.push({
        selector: `[${name}]`,
        score: 70,
        reason: `the markup marks this element with ${name}`,
      });
    }
  }

  // A bare `data-*` flag is a deliberate hook and is usually the most stable
  // thing on the element.
  for (const [name, value] of Object.entries(element.attribs)) {
    if (!name.startsWith('data-') || SEMANTIC_ATTRS.includes(name)) continue;
    if (value !== '' && value.length > 30) continue;
    found.push({
      selector: value === '' ? `[${name}]` : `[${name}="${value.replace(/"/g, '\\"')}"]`,
      score: 75,
      reason: `the theme marks this element with ${name}`,
    });
  }

  for (const name of classesOf(element)) {
    if (isGeneratedClass(name)) continue;

    const meaningful = MEANINGFUL.some((word) => name.toLowerCase().includes(word));
    const utility = isUtilityClass(name);
    found.push({
      selector: `.${name}`,
      score: meaningful ? 80 : utility ? 15 : 45,
      reason: meaningful ? `the class "${name}" names what this element is` : `the class "${name}"`,
    });
  }

  if (/^h[1-6]$/.test(tag)) {
    found.push({ selector: tag, score: 55, reason: `it is the card's ${tag} heading` });
  } else if (tag === 'img' || tag === 'a' || tag === 'time') {
    found.push({ selector: tag, score: 35, reason: `it is the card's <${tag}>` });
  }

  return found.sort((a, b) => b.score - a.score);
}

/** Index among element siblings, 1-based, for the last-resort selector. */
export function positionOf(element: Element): number {
  const parent = element.parent;
  if (parent === null || !('children' in parent)) return 1;
  const siblings = childElements(parent as Element).filter(
    (sibling) => tagName(sibling) === tagName(element)
  );
  return siblings.indexOf(element) + 1;
}

/**
 * The ancestors between a descendant and a root, nearest first.
 * Returns `undefined` when the descendant is not inside the root at all.
 */
export function ancestorsWithin(root: Element, element: Element): Element[] | undefined {
  const chain: Element[] = [];
  let current = element.parent;

  while (current !== null && 'children' in current) {
    const node = current as Element;
    if (node === root) return chain;
    chain.push(node);
    current = node.parent;
  }
  return undefined;
}
