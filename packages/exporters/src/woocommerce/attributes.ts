/**
 * Aligning variation attributes with their parent's.
 *
 * WooCommerce links a variation to a parent option by looking the attribute up
 * as `sanitize_title($name)` on the parent and then storing the value verbatim.
 * If the name does not match, the variation silently gets no attributes; if the
 * value is not in the parent's option list, the variation exists but can never
 * be selected. Both failures are silent, which is why this module reports
 * everything it changes. See CLAUDE.md §7.6/§7.7.
 */

import { type CanonicalProduct, cleanText, foldForCompare } from '@proc123/core';

import type { WooExportWarning } from './types.js';

export interface AttributeSlot {
  /** Exact spelling written to `Attribute N name`. */
  name: string;
  /** Exact spellings written to the parent's `Attribute N value(s)`. */
  values: string[];
  isVariationAxis: boolean;
}

export interface AlignedGroup {
  slots: AttributeSlot[];
  /**
   * Per variation, the value to write in each slot — `undefined` where that
   * variation does not use the slot.
   */
  variationValues: (string | undefined)[][];
  warnings: WooExportWarning[];
}

interface WorkingSlot extends AttributeSlot {
  key: string;
  exactByFold: Map<string, string>;
}

export interface AlignOptions {
  repairVariationValues: boolean;
}

/**
 * Build the attribute columns for one parent and its variations.
 *
 * Values are `cleanText`ed on both sides so that a non-breaking space on the
 * parent and a normal space on the variation still match, but never folded —
 * the exported strings keep their original spelling.
 */
export function alignAttributes(
  parent: CanonicalProduct,
  variations: readonly CanonicalProduct[],
  options: AlignOptions
): AlignedGroup {
  const warnings: WooExportWarning[] = [];
  const slots: WorkingSlot[] = parent.attributes.map((attribute) => {
    const values = attribute.values.map(cleanText).filter((value) => value !== '');
    return {
      name: cleanText(attribute.name),
      values,
      isVariationAxis: attribute.isVariationAxis,
      key: foldForCompare(attribute.name),
      exactByFold: new Map(values.map((value) => [foldForCompare(value), value])),
    };
  });

  const variationValues: (string | undefined)[][] = [];

  for (const variation of variations) {
    const row: (string | undefined)[] = [];

    for (const attribute of variation.attributes) {
      const key = foldForCompare(attribute.name);
      const name = cleanText(attribute.name);
      const values = attribute.values.map(cleanText).filter((value) => value !== '');

      if (values.length > 1) {
        warnings.push({
          code: 'variation-multiple-values',
          message: `Variation attribute "${name}" has ${String(values.length)} values; WooCommerce keeps only the first ("${values[0] ?? ''}").`,
          ...identify(variation),
        });
      }

      const value = values[0];
      if (value === undefined) continue;

      let slot = slots.find((candidate) => candidate.key === key);

      if (slot === undefined) {
        warnings.push({
          code: 'variation-attribute-not-on-parent',
          message: options.repairVariationValues
            ? `Attribute "${name}" is on a variation but not on its parent; it was added to the parent so the variation works.`
            : `Attribute "${name}" is on a variation but not on its parent; WooCommerce will ignore it.`,
          ...identify(variation),
        });

        if (!options.repairVariationValues) continue;

        slot = { name, values: [], isVariationAxis: true, key, exactByFold: new Map() };
        slots.push(slot);
      }

      slot.isVariationAxis = true;
      row[slots.indexOf(slot)] = resolveValue(slot, value, variation, options, warnings);
    }

    variationValues.push(row);
  }

  return {
    slots: slots.map(({ name, values, isVariationAxis }) => ({ name, values, isVariationAxis })),
    variationValues,
    warnings,
  };
}

function resolveValue(
  slot: WorkingSlot,
  value: string,
  variation: CanonicalProduct,
  options: AlignOptions,
  warnings: WooExportWarning[]
): string {
  if (slot.values.includes(value)) return value;

  const fold = foldForCompare(value);
  const equivalent = slot.exactByFold.get(fold);

  if (equivalent !== undefined) {
    // Same value, different spelling. WooCommerce compares byte-for-byte, so
    // write the parent's spelling on the variation row.
    warnings.push({
      code: 'variation-value-normalized',
      message: `Variation value "${value}" was written as "${equivalent}" to match the parent's "${slot.name}" options.`,
      ...identify(variation),
    });
    return equivalent;
  }

  if (options.repairVariationValues) {
    slot.values.push(value);
    slot.exactByFold.set(fold, value);
    warnings.push({
      code: 'variation-value-added-to-parent',
      message: `Value "${value}" was missing from the parent's "${slot.name}" options and was added to it.`,
      ...identify(variation),
    });
    return value;
  }

  warnings.push({
    code: 'variation-value-not-on-parent',
    message: `Value "${value}" is not among the parent's "${slot.name}" options; this variation will not be selectable.`,
    ...identify(variation),
  });
  return value;
}

function identify(product: CanonicalProduct): { sku?: string; sourceUrl: string } {
  return product.sku === undefined
    ? { sourceUrl: product.sourceUrl }
    : { sku: product.sku, sourceUrl: product.sourceUrl };
}
