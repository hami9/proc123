/**
 * Handles — the column that decides which rows are the same product.
 *
 * This is the Shopify equivalent of WooCommerce's SKU/Parent pairing, and it is
 * the same class of correctness problem: get it wrong and rows silently merge
 * or split. Two products that end up with one handle become one product with
 * the second's variants attached; a variation whose handle does not match its
 * parent's becomes a separate product with one variant.
 *
 * Two constraints beyond "make a slug":
 *
 * - **Handles are ASCII.** Shopify allows letters, numbers and dashes, and a
 *   Persian product name slugifies to a run of Persian letters that is not a
 *   usable URL. `slugify`'s `ascii` mode with a hash fallback is exactly this
 *   case — the same escape hatch generated SKUs already use.
 * - **Handles must be unique across the file.** Two products called "گردو" are
 *   two products, and letting them collide would merge them.
 */

import { type CanonicalProduct, shortHash, slugify } from '@proc123/core';

/** Shopify's allowed character set for a handle. */
const INVALID = /[^a-z0-9-]+/g;

/** Length Shopify accepts comfortably; long handles are truncated, not rejected. */
const MAX_LENGTH = 255;

export interface HandleOptions {
  /** Prefix every handle, for a store that imports from several sources. */
  prefix?: string;
}

/**
 * Turn a product into a handle candidate, before uniqueness is applied.
 *
 * Falls back through name → SKU → source URL → hash, because a handle is
 * mandatory: a row without one is not attached to any product, and Shopify
 * rejects the file rather than guessing.
 */
export function handleCandidate(product: CanonicalProduct, options: HandleOptions = {}): string {
  const fromName = slugify(product.name, { ascii: true, hash: (value) => shortHash(value, 10) });
  const base =
    clean(fromName) ||
    clean(slugify(product.sku ?? '', { ascii: true, hash: (value) => shortHash(value, 10) })) ||
    clean(shortHash(product.sourceUrl, 12));

  const prefixed = options.prefix === undefined ? base : `${clean(options.prefix)}-${base}`;
  return prefixed.slice(0, MAX_LENGTH).replace(/-+$/, '');
}

function clean(value: string): string {
  return value
    .toLowerCase()
    .replace(INVALID, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Assign a unique handle to every parent product, in order.
 *
 * Collisions get a numeric suffix rather than a hash: `walnut-2` is something a
 * user can recognise as the second walnut, and the alternative is a file where
 * two different products silently became one.
 *
 * Variations are not given handles of their own — they inherit their parent's,
 * which is what makes them variants rather than products.
 */
export function assignHandles(
  products: readonly CanonicalProduct[],
  options: HandleOptions = {}
): { handles: Map<CanonicalProduct, string>; collisions: number } {
  const handles = new Map<CanonicalProduct, string>();
  const used = new Set<string>();
  let collisions = 0;

  for (const product of products) {
    if (product.kind === 'variation') continue;

    const base = handleCandidate(product, options);
    let handle = base;
    let suffix = 2;
    while (used.has(handle)) {
      handle = `${base}-${String(suffix)}`;
      suffix += 1;
      collisions += 1;
    }

    used.add(handle);
    handles.set(product, handle);
  }

  return { handles, collisions };
}
