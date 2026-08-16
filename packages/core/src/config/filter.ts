/**
 * Applying a config to a finished scan.
 *
 * Three filters, and one rule that runs through all of them: **a variation
 * follows its parent.** Dropping a variable product while keeping its
 * variations leaves rows whose `Parent` column points at nothing; the exporter
 * discards them with a warning, so the user asked for fewer products and got
 * fewer *and* a warning they did not cause. Keeping a variation whose parent
 * was filtered out is the same bug from the other side.
 *
 * So filtering is done on parents, and variations are carried along with them.
 */

import type { CanonicalProduct, ProductKind } from '../model.js';
import type { ExtractionIssue } from '../extract/types.js';
import { foldForCompare } from '../text.js';
import { canonicalizeUrl } from '../url.js';
import {
  ALL_TARGET_FIELDS,
  FIELD_PROPERTIES,
  type Proc123Config,
  type TargetField,
} from './types.js';

/**
 * Blank the fields the user did not ask for.
 *
 * The confidence entry goes with the value: leaving one behind would have the
 * "why is this field empty?" report claim a field was extracted when it was
 * deliberately dropped.
 */
export function applyTargetFields(
  product: CanonicalProduct,
  fields: readonly TargetField[]
): CanonicalProduct {
  const wanted = new Set(fields);
  const drop = ALL_TARGET_FIELDS.filter((field) => !wanted.has(field)).flatMap(
    (field) => FIELD_PROPERTIES[field]
  );
  if (drop.length === 0) return product;

  const copy: CanonicalProduct = {
    ...product,
    extractionMeta: {
      ...product.extractionMeta,
      fieldConfidence: { ...product.extractionMeta.fieldConfidence },
    },
  };
  const mutable = copy as unknown as Record<string, unknown>;

  for (const property of drop) {
    // The three required arrays are emptied rather than deleted: the model says
    // they are always present, and an absent one would be a different bug.
    if (property === 'categoryPath' || property === 'images' || property === 'attributes') {
      mutable[property] = [];
    } else {
      delete mutable[property];
    }
    delete copy.extractionMeta.fieldConfidence[property];
  }

  return copy;
}

/** `آجیل > گردو` matches a product filed under it or anywhere below it. */
export function matchesCategory(product: CanonicalProduct, filter: string): boolean {
  const wanted = filter
    .split('>')
    .map((segment) => foldForCompare(segment))
    .filter((segment) => segment !== '');
  if (wanted.length === 0) return true;

  const path = product.categoryPath.map((segment) => foldForCompare(segment));

  // A path filter matches a prefix — `آجیل` keeps everything under it.
  if (wanted.every((segment, index) => path[index] === segment)) return true;

  // A single segment also matches anywhere in the trail, so filtering by the
  // leaf category works without typing its ancestors.
  return wanted.length === 1 && wanted[0] !== undefined && path.includes(wanted[0]);
}

export interface FilterCounts {
  /** Parents removed because their type was not asked for. */
  byProductType: number;
  /** Parents removed because they are filed somewhere else. */
  byCategory: number;
  /** Variations removed with their parent, or because their parent was missing. */
  variations: number;
}

export interface FilterResult {
  products: CanonicalProduct[];
  issues: ExtractionIssue[];
  counts: FilterCounts;
}

function parentKeyOf(product: CanonicalProduct): string {
  return product.parentSku ?? canonicalizeUrl(product.sourceUrl);
}

function ownKeyOf(product: CanonicalProduct): string {
  return product.sku ?? canonicalizeUrl(product.sourceUrl);
}

/**
 * Filter and trim a scan according to the config.
 *
 * Order preserved throughout, because WooCommerce needs each parent row
 * immediately before its own variation rows and a filter that reordered them
 * would produce a file that imports incompletely.
 */
export function applyConfig(
  products: readonly CanonicalProduct[],
  config: Proc123Config
): FilterResult {
  const issues: ExtractionIssue[] = [];
  const counts: FilterCounts = { byProductType: 0, byCategory: 0, variations: 0 };

  const wantedKinds = new Set<ProductKind>(config.productTypes);
  const filter = config.categoryFilter;

  // Decide about parents first; variations inherit that decision, so a kept
  // variable product keeps its variations even when `productTypes` does not
  // list `variation`, and a dropped one takes them with it.
  const keptParents = new Set<string>();
  const parents = products.filter((product) => product.kind !== 'variation');

  for (const parent of parents) {
    if (!wantedKinds.has(parent.kind)) {
      counts.byProductType += 1;
      continue;
    }
    if (filter !== undefined && !matchesCategory(parent, filter)) {
      counts.byCategory += 1;
      continue;
    }
    keptParents.add(ownKeyOf(parent));
    keptParents.add(canonicalizeUrl(parent.sourceUrl));
  }

  const kept: CanonicalProduct[] = [];
  for (const product of products) {
    if (product.kind === 'variation') {
      if (keptParents.has(parentKeyOf(product))) kept.push(product);
      else counts.variations += 1;
      continue;
    }
    if (keptParents.has(ownKeyOf(product))) kept.push(product);
  }

  const trimmed = kept.map((product) => applyTargetFields(product, config.targetFields));

  if (counts.byProductType > 0) {
    issues.push({
      severity: 'info',
      code: 'filtered-by-product-type',
      message:
        `${String(counts.byProductType)} product(s) were left out because their type is not in ` +
        `${config.productTypes.join(' / ')}.`,
    });
  }
  if (counts.byCategory > 0) {
    issues.push({
      severity: 'info',
      code: 'filtered-by-category',
      message: `${String(counts.byCategory)} product(s) were left out; they are not under "${String(filter)}".`,
    });
  }
  if (counts.variations > 0) {
    issues.push({
      severity: 'info',
      code: 'filtered-variations',
      message:
        `${String(counts.variations)} variation(s) went with the products they belong to. ` +
        `A variation without its parent cannot be imported.`,
    });
  }

  const off = ALL_TARGET_FIELDS.filter((field) => !config.targetFields.includes(field));
  if (off.length > 0 && trimmed.length > 0) {
    issues.push({
      severity: 'info',
      code: 'fields-turned-off',
      message: `These fields are empty because the settings turn them off: ${off.join(', ')}.`,
    });
  }

  return { products: trimmed, issues, counts };
}
