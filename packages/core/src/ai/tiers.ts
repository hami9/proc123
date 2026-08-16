/**
 * The gate: does Layer D run at all?
 *
 * CLAUDE.md §4 — "Fires only when Tier-1 fields are still incomplete." That is
 * a cost control and a correctness control at once. Every call costs the user
 * money, and a model asked to confirm a field that Layer A already read from
 * the store's own API can only make it worse.
 *
 * Two refinements the brief implies rather than states:
 *
 * - **Absent is not the same as missing.** §6 lists sale price in Tier 1, but
 *   most products are not on sale; treating "no sale price" as incomplete would
 *   fire Layer D on every well-extracted page in a catalogue. Only fields a
 *   product page is genuinely expected to carry can hold the gate open.
 * - **A field the user turned off cannot be missing.** §9's `targetFields`
 *   decides what gets exported, so paying to fill a column that will be blanked
 *   by `applyTargetFields` is pure waste.
 */

import type { CanonicalProduct } from '../model.js';
import type { TargetField } from '../config/types.js';

/**
 * Tier-1 fields whose absence means the extraction is incomplete.
 *
 * Expressed as user-facing `TargetField` names so this list can be intersected
 * with the config directly.
 *
 * Deliberately excluded, though §6 lists them as Tier 1:
 * - `salePrice` — absent means "not on sale", which is the common case.
 * - product type and parent link — structural, inferred by the pipeline from
 *   the shape of what it found rather than read off the page.
 * - `attributes` — a simple product has none, and Layer D cannot tell the
 *   difference between "no attributes published" and "no attributes exist".
 *   Handled by `missingTier1For` instead, which knows the product's kind.
 */
export const GATING_TIER_1: readonly TargetField[] = [
  'name',
  'regularPrice',
  'categories',
  'images',
  'description',
  'stock',
];

/** True when the product carries nothing usable for that field. */
function isEmpty(product: CanonicalProduct, field: TargetField): boolean {
  switch (field) {
    case 'name':
      return product.name.trim() === '';
    case 'regularPrice':
      return product.regularPrice === undefined;
    case 'salePrice':
      return product.salePrice === undefined;
    case 'categories':
      return product.categoryPath.length === 0;
    case 'images':
      return product.images.length === 0;
    case 'description':
      return product.description === undefined || product.description.trim() === '';
    case 'shortDescription':
      return product.shortDescription === undefined || product.shortDescription.trim() === '';
    case 'stock':
      return product.inStock === undefined;
    case 'attributes':
      return product.attributes.length === 0;
    case 'sku':
      return product.sku === undefined || product.sku.trim() === '';
    case 'tags':
      return product.tags === undefined || product.tags.length === 0;
    case 'weight':
      return product.weight === undefined;
    case 'dimensions':
      return product.dimensions === undefined;
    case 'brand':
      return product.brand === undefined || product.brand.trim() === '';
    case 'gtin':
      return product.gtin === undefined || product.gtin.trim() === '';
    default: {
      // Exhaustive: adding a TargetField without a rule here fails to compile.
      const never: never = field;
      return never;
    }
  }
}

/**
 * Which gating fields this product is still missing.
 *
 * `wanted` is the config's `targetFields`. A variable product also has to have
 * attributes — without them the variation rows have no axes and the CSV
 * imports as a product nobody can choose an option on.
 */
export function missingTier1For(
  product: CanonicalProduct,
  wanted: readonly TargetField[]
): TargetField[] {
  const asked = new Set(wanted);
  const gating: TargetField[] = GATING_TIER_1.filter((field) => asked.has(field));
  if (product.kind === 'variable' && asked.has('attributes')) gating.push('attributes');

  return gating.filter((field) => isEmpty(product, field));
}

/**
 * The gate itself.
 *
 * A variation is never sent on its own: it has no page of its own to trim, and
 * its fields come from the parent's variation table. Sending the parent's
 * fragment once and letting the answer inform the parent is both cheaper and
 * the only version that can be verified.
 */
export function needsAI(product: CanonicalProduct, wanted: readonly TargetField[]): boolean {
  if (product.kind === 'variation') return false;
  return missingTier1For(product, wanted).length > 0;
}

/** Field-level check, used after an answer arrives to skip what got filled. */
export function isFieldEmpty(product: CanonicalProduct, field: TargetField): boolean {
  return isEmpty(product, field);
}
