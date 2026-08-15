/**
 * One product, once.
 *
 * CLAUDE.md §10: "Deduplicate by canonical URL + SKU — infinite scroll and
 * pagination overlap constantly." They do: a "load more" that appends without
 * removing, a sort order that shifts while you page through it, a category
 * reachable at two URLs. Without this a scan of five pages exports the first
 * page four times.
 *
 * Two keys, because neither alone is enough. URL catches the same product seen
 * on two pages; SKU catches the same product seen at two URLs. Variations need
 * a third component, because `flattenDraft` deliberately gives every variation
 * its parent's URL — deduplicating on URL alone would collapse a variable
 * product down to a single row.
 */

import type { CanonicalProduct } from '../model.js';
import { foldForCompare } from '../text.js';
import { canonicalizeUrl } from '../url.js';

/**
 * What identifies a variation when it has no SKU yet: its axis values. SKUs are
 * assigned at export time, so during a crawl most variations have none.
 */
function variationKey(product: CanonicalProduct): string {
  if (product.sku !== undefined && product.sku !== '') return foldForCompare(product.sku);

  const axes = product.attributes
    .filter((attribute) => attribute.isVariationAxis)
    .map(
      (attribute) =>
        `${foldForCompare(attribute.name)}=${foldForCompare(attribute.values.join('|'))}`
    )
    .sort();

  return axes.length > 0 ? axes.join('&') : foldForCompare(product.name);
}

export function productKey(product: CanonicalProduct): string {
  const url = canonicalizeUrl(product.sourceUrl);
  return product.kind === 'variation' ? `${url}#${variationKey(product)}` : url;
}

/**
 * Fold a second sighting of a product into the first.
 *
 * Field by field, keeping whichever was recorded with more confidence — the
 * same rule the extraction layers use, applied to finished products via the
 * `fieldConfidence` they carry. A listing page and a product page describe the
 * same thing at different depths, and the deeper one should win without the
 * shallower one having to be thrown away wholesale.
 */
export function mergeProducts(
  existing: CanonicalProduct,
  incoming: CanonicalProduct
): CanonicalProduct {
  const merged: CanonicalProduct = {
    ...existing,
    extractionMeta: {
      ...existing.extractionMeta,
      fieldConfidence: { ...existing.extractionMeta.fieldConfidence },
    },
  };

  const held = merged.extractionMeta.fieldConfidence;
  // Writing through a key known only as a string is not provable to
  // TypeScript, though it is sound here: both sides are the same product type
  // and the value is read from the same field it is written to.
  const target = merged as unknown as Record<string, unknown>;
  const source = incoming as unknown as Record<string, unknown>;

  for (const [field, confidence] of Object.entries(incoming.extractionMeta.fieldConfidence)) {
    const value = source[field];
    if (value === undefined) continue;
    if ((held[field] ?? -1) >= confidence) continue;

    target[field] = value;
    held[field] = confidence;
  }

  // Variations are not merged across sightings — two lists in different orders
  // cannot be reconciled without guessing, and a guess duplicates rows.
  return merged;
}

export interface DedupeResult {
  products: CanonicalProduct[];
  /** How many sightings were folded into an earlier one. */
  duplicates: number;
}

/**
 * An index that keeps the first sighting of each product and enriches it with
 * later ones, preserving the order products were first seen in.
 *
 * Insertion order matters and is preserved: WooCommerce requires each parent
 * row to sit immediately before its own variation rows, and a crawl that
 * reordered them would produce a file that imports incompletely.
 */
export class ProductIndex {
  private readonly byKey = new Map<string, CanonicalProduct>();
  private readonly bySku = new Map<string, string>();
  private readonly order: string[] = [];
  private duplicates = 0;

  add(product: CanonicalProduct): void {
    const key = this.resolveKey(product);
    const existing = this.byKey.get(key);

    if (existing === undefined) {
      this.byKey.set(key, product);
      this.order.push(key);
      this.rememberSku(product, key);
      return;
    }

    this.duplicates += 1;
    this.byKey.set(key, mergeProducts(existing, product));
    this.rememberSku(product, key);
  }

  addAll(products: Iterable<CanonicalProduct>): void {
    for (const product of products) this.add(product);
  }

  /**
   * A product already seen under a different URL is found by its SKU. Only
   * parents are matched this way: two variations of different products can
   * legitimately share nothing but a blank SKU.
   */
  private resolveKey(product: CanonicalProduct): string {
    const key = productKey(product);
    if (this.byKey.has(key)) return key;

    if (product.kind !== 'variation' && product.sku !== undefined && product.sku !== '') {
      const known = this.bySku.get(foldForCompare(product.sku));
      if (known !== undefined) return known;
    }
    return key;
  }

  private rememberSku(product: CanonicalProduct, key: string): void {
    if (product.kind === 'variation') return;
    if (product.sku === undefined || product.sku === '') return;
    const folded = foldForCompare(product.sku);
    if (!this.bySku.has(folded)) this.bySku.set(folded, key);
  }

  get size(): number {
    return this.byKey.size;
  }

  result(): DedupeResult {
    const products = this.order
      .map((key) => this.byKey.get(key))
      .filter((product): product is CanonicalProduct => product !== undefined);
    return { products, duplicates: this.duplicates };
  }
}

/** Convenience for a single list, e.g. merging two scans after the fact. */
export function dedupeProducts(products: readonly CanonicalProduct[]): DedupeResult {
  const index = new ProductIndex();
  index.addAll(products);
  return index.result();
}
