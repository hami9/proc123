/**
 * Learning a store from three clicks.
 *
 * The user points at the title, the price and the image on **one** product
 * card. From that, two things have to be worked out: which element is the card
 * — because everything else is relative to it — and a selector for each field
 * that will still match after the store's next deploy.
 *
 * The card is found by looking for repetition. A product card is, by
 * definition, the thing there are lots of, so the lowest ancestor of the clicks
 * that has siblings shaped like itself is it. That is more reliable than any
 * class-name heuristic, because it uses the one fact that is true of every
 * storefront on every platform.
 */

import {
  type CheerioAPI,
  type Element,
  childElements,
  isElement,
  tagName,
} from '../extract/html.js';
import type { FieldRule, FieldRules, ProfileField, SiteProfile } from '@proc123/profiles';
import { PROFILE_VERSION, profileDomain } from '@proc123/profiles';
import {
  type Candidate,
  ancestorsWithin,
  candidatesFor,
  classesOf,
  isGeneratedClass,
  positionOf,
} from './selector.js';

/**
 * Where a clicked element is, as child-element indices from the document root.
 *
 * The extension cannot send a DOM node across a message boundary, and it should
 * not send a selector either — deriving one is this module's job, and the
 * browser's own `Element.matches`-shaped guesses are exactly the brittle
 * `nth-child` chains CLAUDE.md §4 warns about. An index path is unambiguous and
 * survives serialization; walking it against the re-parsed HTML lands on the
 * same element because the browser already normalized the DOM before it was
 * serialized.
 */
export type ElementPath = number[];

export function resolvePath($: CheerioAPI, path: ElementPath): Element | undefined {
  const root = $.root().children().toArray().find(isElement);
  if (root === undefined) return undefined;

  let element = root;
  for (const index of path) {
    const child = childElements(element)[index];
    if (child === undefined) return undefined;
    element = child;
  }
  return element;
}

/**
 * The inverse of `resolvePath`: where an element sits, as an index path.
 *
 * The extension's picker computes the same thing against the live DOM. Having
 * both sides of the round trip in one place is what keeps them agreeing.
 */
export function pathOf(element: Element): ElementPath {
  const path: number[] = [];
  let node = element;

  for (;;) {
    const parent = node.parent;
    if (parent === null || !('children' in parent)) break;

    const at = childElements(parent as Element).indexOf(node);
    if (at < 0) break;
    path.unshift(at);
    node = parent as Element;
    if (tagName(node) === 'html') break;
  }
  return path;
}

/** How similar two elements look, for deciding whether they are the same kind of thing. */
function signature(element: Element): string {
  const classes = classesOf(element)
    .filter((name) => !isGeneratedClass(name))
    .sort()
    .join('.');
  return `${tagName(element)}${classes === '' ? '' : `.${classes}`}`;
}

function siblingsLike(element: Element): number {
  const parent = element.parent;
  if (parent === null || !('children' in parent)) return 0;
  const own = signature(element);
  return childElements(parent as Element).filter((sibling) => signature(sibling) === own).length;
}

/** Guard against walking out of a card and into the page chrome. */
const MAX_CARD_DEPTH = 14;

function lowestCommonAncestor(elements: readonly Element[]): Element | undefined {
  const [first, ...rest] = elements;
  if (first === undefined) return undefined;

  const chainOf = (element: Element): Element[] => {
    const chain: Element[] = [element];
    let current = element.parent;
    while (current !== null && 'children' in current) {
      chain.push(current as Element);
      current = (current as Element).parent;
    }
    return chain;
  };

  let common = chainOf(first);
  for (const element of rest) {
    const other = new Set(chainOf(element));
    common = common.filter((node) => other.has(node));
  }
  return common[0];
}

export interface CardDetection {
  card: Element;
  /** How many cards like it are on the page. One means we could not confirm it. */
  siblings: number;
  reason: string;
}

/**
 * Find the product card containing the clicked elements.
 *
 * Walks up from their common ancestor until it finds a level that repeats. A
 * page with exactly one product still returns an answer — the common ancestor —
 * but says the repetition could not be confirmed, so the caller can warn rather
 * than silently learn a selector from a sample of one.
 */
export function findCard(elements: readonly Element[]): CardDetection | undefined {
  const start = lowestCommonAncestor(elements);
  if (start === undefined) return undefined;

  let current: Element | undefined = start;
  for (let depth = 0; depth < MAX_CARD_DEPTH && current !== undefined; depth++) {
    const like = siblingsLike(current);
    if (like >= 2) {
      return {
        card: current,
        siblings: like,
        reason: `${String(like)} elements on the page look like this one, so it is the product card`,
      };
    }
    const parent: unknown = current.parent;
    current =
      parent !== null && typeof parent === 'object' && 'children' in parent
        ? (parent as Element)
        : undefined;
  }

  return {
    card: start,
    siblings: 1,
    reason: 'no repeating element was found, so the smallest box containing every click was used',
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

interface Derived {
  selector: string;
  reason: string;
}

/**
 * A selector for the card itself, matching every card on the page.
 *
 * Unlike a field selector this one *should* match many elements — that is the
 * point — so it is scoped by the card's own signature and, when that is not
 * distinctive enough, by its container.
 */
export function deriveCardSelector($: CheerioAPI, card: Element): Derived {
  const own = candidatesFor(card).filter((candidate) => candidate.score >= 40);
  const expected = siblingsLike(card);

  const matchesAll = (selector: string): boolean => {
    const found = $(selector);
    return found.length >= Math.max(2, expected) && found.toArray().includes(card);
  };

  for (const candidate of own) {
    if (matchesAll(candidate.selector)) {
      return { selector: candidate.selector, reason: candidate.reason };
    }
  }

  // Combining the card's own classes narrows it without reaching for position.
  const combined = own
    .filter((candidate) => candidate.selector.startsWith('.'))
    .slice(0, 2)
    .map((candidate) => candidate.selector)
    .join('');
  if (combined !== '' && matchesAll(combined)) {
    return { selector: combined, reason: `the card is marked ${combined}` };
  }

  // Scope by the grid the cards sit in.
  const parent = card.parent;
  if (parent !== null && 'children' in parent) {
    const parentCandidate = candidatesFor(parent as Element)[0];
    const best = own[0];
    if (parentCandidate !== undefined && best !== undefined) {
      const scoped = `${parentCandidate.selector} > ${best.selector}`;
      if (matchesAll(scoped)) {
        return {
          selector: scoped,
          reason: `cards are the ${best.selector} children of ${parentCandidate.selector}`,
        };
      }
    }
  }

  const fallback = own[0]?.selector ?? tagName(card);
  return {
    selector: fallback,
    reason: 'no distinctive markup was found on the card, so its tag and classes were used',
  };
}

/**
 * A selector for one field, relative to the card and unique within it.
 *
 * Tries the element's own best candidate, then combinations, then scopes by an
 * ancestor. `:nth-of-type` is reached for only when nothing else distinguishes
 * the element — and the reason written into the profile says so, because that
 * is the rule a person should check first when a profile stops working.
 */
export function deriveFieldSelector(
  $: CheerioAPI,
  card: Element,
  target: Element
): Derived | undefined {
  const ancestors = ancestorsWithin(card, target);
  if (ancestors === undefined) return undefined;

  const scoped = $(card);
  const isUnique = (selector: string): boolean => {
    const found = scoped.find(selector);
    return found.length === 1 && found.get(0) === target;
  };
  const isFirst = (selector: string): boolean => scoped.find(selector).get(0) === target;

  const own = candidatesFor(target);

  for (const candidate of own) {
    if (isUnique(candidate.selector))
      return { selector: candidate.selector, reason: candidate.reason };
  }

  // Two weak signals together often beat one: `a.woocommerce-loop-product__link`.
  for (let i = 0; i < own.length; i++) {
    for (let j = i + 1; j < own.length; j++) {
      const a = own[i];
      const b = own[j];
      if (a === undefined || b === undefined) continue;
      // Only combinable when neither is a bare tag in trailing position.
      const combined =
        a.selector.startsWith('.') || a.selector.startsWith('[')
          ? `${b.selector.match(/^[a-z]+$/) === null ? '' : b.selector}${a.selector}`
          : `${a.selector}${b.selector}`;
      if (combined === '' || combined === a.selector) continue;
      if (isUnique(combined)) {
        return { selector: combined, reason: `${a.reason}, narrowed by ${b.reason}` };
      }
    }
  }

  // Scope by an ancestor inside the card.
  for (const ancestor of ancestors) {
    const ancestorBest = candidatesFor(ancestor)[0];
    if (ancestorBest === undefined) continue;
    for (const candidate of own.slice(0, 3)) {
      const combined = `${ancestorBest.selector} ${candidate.selector}`;
      if (isUnique(combined)) {
        return { selector: combined, reason: `${candidate.reason}, inside ${ancestorBest.reason}` };
      }
    }
  }

  // Several identical elements — an image gallery, two prices. Taking the first
  // is usually right and is far less brittle than a full positional chain.
  for (const candidate of own) {
    if (isFirst(candidate.selector)) {
      return {
        selector: candidate.selector,
        reason: `${candidate.reason} — the card has more than one, so the first is used`,
      };
    }
  }

  const positional = `${tagName(target)}:nth-of-type(${String(positionOf(target))})`;
  return {
    selector: positional,
    reason:
      'nothing on this element identified it, so its position is used — ' +
      'this is the rule most likely to break when the theme changes',
  };
}

// ---------------------------------------------------------------------------
// The whole flow
// ---------------------------------------------------------------------------

/** What the user pointed at, and which field they said it was. */
export interface FieldPick {
  field: ProfileField;
  path: ElementPath;
}

export interface LearnOptions {
  url: string;
  label?: string;
  now?: () => string;
}

export interface LearnResult {
  profile?: SiteProfile;
  /** Everything the user should be told before saving.  */
  warnings: string[];
  /** How many cards the derived container selector matched. */
  cardCount: number;
}

/** Attributes to read a field from, when the field is a URL or an image. */
const ATTRIBUTE_FIELDS: Partial<Record<ProfileField, string>> = {
  url: 'href',
  image: 'src',
};

/**
 * Turn a set of clicks into a profile.
 *
 * Returns warnings rather than throwing for anything the user can still choose
 * to accept: a card that could not be confirmed by repetition, a field whose
 * selector had to fall back to position. Only a missing name is fatal, because
 * a card with no name is not a product.
 */
export function learnProfile(
  $: CheerioAPI,
  picks: readonly FieldPick[],
  options: LearnOptions
): LearnResult {
  const warnings: string[] = [];

  const resolved = picks
    .map((pick) => ({ field: pick.field, element: resolvePath($, pick.path) }))
    .filter(
      (pick): pick is { field: ProfileField; element: Element } => pick.element !== undefined
    );

  if (resolved.length < picks.length) {
    warnings.push('Some of the picked elements could not be found in the page and were ignored.');
  }
  if (!resolved.some((pick) => pick.field === 'name')) {
    return {
      warnings: [
        ...warnings,
        'Point at the product name — nothing else can be exported without it.',
      ],
      cardCount: 0,
    };
  }

  const detection = findCard(resolved.map((pick) => pick.element));
  if (detection === undefined) {
    return {
      warnings: [...warnings, 'The picked elements are not on the same page.'],
      cardCount: 0,
    };
  }
  if (detection.siblings < 2) {
    warnings.push(
      'Only one product card was found, so the selectors were learned from a single example. ' +
        'Check them against a fuller category page before relying on this profile.'
    );
  }

  const container = deriveCardSelector($, detection.card);
  const fields: FieldRules = {};

  for (const pick of resolved) {
    const derived = deriveFieldSelector($, detection.card, pick.element);
    if (derived === undefined) {
      warnings.push(`The element picked for "${pick.field}" is not inside the product card.`);
      continue;
    }
    if (derived.selector.includes(':nth-of-type')) {
      warnings.push(
        `"${pick.field}" had to be identified by its position, which is the first thing to break ` +
          'when the store changes its theme.'
      );
    }

    const attribute = ATTRIBUTE_FIELDS[pick.field];
    const rule: FieldRule =
      attribute === undefined
        ? { selector: derived.selector, from: 'text', note: derived.reason }
        : { selector: derived.selector, from: 'attribute', attribute, note: derived.reason };
    fields[pick.field] = rule;
  }

  // Three clicks, per CLAUDE.md §4 — title, price, image. But a product with no
  // URL is a product that cannot be told apart from its neighbours: SKUs are
  // generated from it and the crawl deduplicates on it, so every card sharing
  // the page's URL would collapse into one row. The link is therefore found
  // rather than asked for, which is nearly always possible because a product
  // card's title is inside its link.
  if (fields.url === undefined) {
    const anchor = findCardLink($, detection.card, resolved);
    if (anchor === undefined) {
      warnings.push(
        'No link was found on the product card, so every product will share the page URL. ' +
          'Point at the product link as well.'
      );
    } else {
      const derived = deriveFieldSelector($, detection.card, anchor);
      if (derived !== undefined) {
        fields.url = {
          selector: derived.selector,
          from: 'attribute',
          attribute: 'href',
          note: `${derived.reason} — found automatically, not picked`,
        };
      }
    }
  }

  const now = options.now ?? ((): string => new Date().toISOString());
  const timestamp = now();

  const profile: SiteProfile = {
    version: PROFILE_VERSION,
    domain: profileDomain(options.url),
    ...(options.label === undefined ? {} : { label: options.label }),
    card: { container: container.selector, fields },
    notes: `Learned from ${options.url}. Cards identified because ${detection.reason}.`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return { profile, warnings, cardCount: $(container.selector).length };
}

/**
 * The link that leads to this card's product page.
 *
 * Looked for around the name first — a storefront almost always wraps the
 * title in the product link — then anywhere in the card. Anchors that clearly
 * go somewhere else (a wishlist toggle, an add-to-cart form) are skipped by
 * preferring the one nearest the name.
 */
function findCardLink(
  $: CheerioAPI,
  card: Element,
  picks: readonly { field: ProfileField; element: Element }[]
): Element | undefined {
  const name = picks.find((pick) => pick.field === 'name')?.element;

  if (name !== undefined) {
    // Up from the name: the enclosing product link.
    for (const ancestor of ancestorsWithin(card, name) ?? []) {
      if (tagName(ancestor) === 'a' && (ancestor.attribs['href'] ?? '') !== '') return ancestor;
    }
    if (tagName(name) === 'a' && (name.attribs['href'] ?? '') !== '') return name;

    // Down from the name: a title that contains its own link.
    const inside = $(name).find('a[href]').get(0);
    if (inside !== undefined) return inside;
  }

  return $(card).find('a[href]').get(0);
}

/** Re-exported so callers can score a candidate without importing two modules. */
export type { Candidate };
