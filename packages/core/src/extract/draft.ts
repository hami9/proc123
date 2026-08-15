/**
 * A product under construction.
 *
 * Several kinds of markup on one page describe the same product, and they
 * disagree: JSON-LD says the price is 150000, an OpenGraph tag says 15000,
 * microdata has the name with the site suffix attached. A draft accumulates
 * every claim with a confidence and remembers where each one came from, so the
 * highest-confidence value wins and the losers are still auditable.
 */

import type { CanonicalProduct, ExtractionLayer, Money, ProductKind } from '../model.js';
import type { ExtractedField, ExtractedFields, ExtractionSource } from './types.js';

export interface DraftValue<T> {
  value: T;
  confidence: number;
  source: ExtractionSource;
}

export type DraftValues = {
  [K in ExtractedField]?: DraftValue<ExtractedFields[K]>;
};

export interface ProductDraft {
  /** The page or product URL this draft describes. */
  sourceUrl: string;
  values: DraftValues;
  /** Variations declared alongside the product, e.g. `hasVariant`. */
  variants: ProductDraft[];
}

export function createDraft(sourceUrl: string): ProductDraft {
  return { sourceUrl, values: {}, variants: [] };
}

/**
 * Absent, blank and empty all mean "the page did not say" and must not
 * overwrite a real value. `false` and `0` are real values — a product that is
 * out of stock, or has none left, is saying something.
 */
function isMeaningful(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Store a value under a key the caller only knows generically.
 *
 * `DraftValues` types each field separately, which is what makes every *read*
 * exact. TypeScript cannot prove a write through a generic key into such a type
 * is sound, so the value side is widened to `unknown` for the write alone —
 * `held` was built from `ExtractedFields[K]` for this very `K`, so it is.
 */
function writeValue<K extends ExtractedField>(
  values: DraftValues,
  field: K,
  held: DraftValue<ExtractedFields[K]>
): void {
  const target: Partial<Record<ExtractedField, DraftValue<unknown>>> = values;
  target[field] = held;
}

/**
 * Record a claim about a field. Keeps the existing value on a tie, so sources
 * offered in priority order behave the way the caller expects.
 */
export function setField<K extends ExtractedField>(
  draft: ProductDraft,
  field: K,
  value: ExtractedFields[K] | undefined,
  confidence: number,
  source: ExtractionSource
): void {
  if (!isMeaningful(value) || value === undefined) return;

  const existing = draft.values[field];
  if (existing !== undefined && existing.confidence >= confidence) return;

  writeValue(draft.values, field, { value, confidence, source });
}

/**
 * Set a field regardless of what is already recorded.
 *
 * For values the caller assembles from several properties and therefore has to
 * write in one go — a product's attribute list, say, which is built from both
 * `additionalProperty` and the variation axes.
 */
export function overwriteField<K extends ExtractedField>(
  draft: ProductDraft,
  field: K,
  value: ExtractedFields[K] | undefined,
  confidence: number,
  source: ExtractionSource
): void {
  if (!isMeaningful(value) || value === undefined) return;
  writeValue(draft.values, field, { value, confidence, source });
}

export function getField<K extends ExtractedField>(
  draft: ProductDraft,
  field: K
): ExtractedFields[K] | undefined {
  return draft.values[field]?.value;
}

export interface PricePair {
  regular?: Money | undefined;
  sale?: Money | undefined;
}

/**
 * Record a price. The regular and sale price move together or not at all.
 *
 * They are one statement — "it was X, it is Y now" — and merging them field by
 * field lets a confident regular price from one source pair up with a sale
 * price from another. The usual result is a product discounted to exactly its
 * own price: a 0% sale the store never ran, imported as permanent markdown.
 *
 * A sale price that is not below the regular price is dropped for the same
 * reason. A lone sale price becomes the regular price, since that is what the
 * customer actually pays.
 */
export function setPricePair(
  draft: ProductDraft,
  pair: PricePair,
  confidence: number,
  source: ExtractionSource
): void {
  if (pair.regular === undefined && pair.sale === undefined) return;

  const held = draft.values.regularPrice ?? draft.values.salePrice;
  if (held !== undefined && held.confidence >= confidence) return;

  const regular = pair.regular ?? pair.sale;
  const sale =
    pair.sale !== undefined && pair.regular !== undefined && pair.sale.amount < pair.regular.amount
      ? pair.sale
      : undefined;

  delete draft.values.regularPrice;
  delete draft.values.salePrice;

  if (regular !== undefined) draft.values.regularPrice = { value: regular, confidence, source };
  if (sale !== undefined) draft.values.salePrice = { value: sale, confidence, source };
}

/** Fold `incoming`'s claims into `target`, keeping the more confident of each. */
export function mergeDraftInto(target: ProductDraft, incoming: ProductDraft): void {
  for (const [field, held] of Object.entries(incoming.values)) {
    const key = field as ExtractedField;
    if (key === 'regularPrice' || key === 'salePrice') continue;
    // The cast re-ties key and value, which `Object.entries` erases. Every
    // entry came out of a `DraftValues` so the pairing is sound by construction.
    setField(target, key, held.value as ExtractedFields[typeof key], held.confidence, held.source);
  }

  const priced = incoming.values.regularPrice ?? incoming.values.salePrice;
  if (priced !== undefined) {
    setPricePair(
      target,
      { regular: incoming.values.regularPrice?.value, sale: incoming.values.salePrice?.value },
      priced.confidence,
      priced.source
    );
  }

  // Variant lists are not merged across sources: two sources listing variations
  // in different orders or granularities cannot be reconciled without guessing,
  // and a guess here duplicates rows in the export.
  if (target.variants.length === 0 && incoming.variants.length > 0) {
    target.variants = incoming.variants;
  }
}

export interface DraftToProductOptions {
  layer: ExtractionLayer;
  /** ISO 8601. */
  scannedAt: string;
}

function fieldConfidence(values: DraftValues): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, held] of Object.entries(values)) {
    out[field] = held.confidence;
  }
  return out;
}

/**
 * Finalize a draft.
 *
 * Returns `undefined` when the draft has no name: a nameless row is not a
 * product, and emitting one produces an untraceable blank in the target store.
 */
export function draftToProduct(
  draft: ProductDraft,
  options: DraftToProductOptions
): CanonicalProduct | undefined {
  const name = getField(draft, 'name');
  if (name === undefined || name === '') return undefined;

  const declaredKind = getField(draft, 'kind');
  const kind: ProductKind = declaredKind ?? (draft.variants.length > 0 ? 'variable' : 'simple');

  const product: CanonicalProduct = {
    sourceUrl: draft.sourceUrl,
    kind,
    name,
    categoryPath: getField(draft, 'categoryPath') ?? [],
    images: getField(draft, 'images') ?? [],
    attributes: getField(draft, 'attributes') ?? [],
    extractionMeta: {
      layer: options.layer,
      fieldConfidence: fieldConfidence(draft.values),
      scannedAt: options.scannedAt,
    },
  };

  const sku = getField(draft, 'sku');
  if (sku !== undefined) product.sku = sku;
  const parentSku = getField(draft, 'parentSku');
  if (parentSku !== undefined) product.parentSku = parentSku;
  const shortDescription = getField(draft, 'shortDescription');
  if (shortDescription !== undefined) product.shortDescription = shortDescription;
  const description = getField(draft, 'description');
  if (description !== undefined) product.description = description;
  const regularPrice = getField(draft, 'regularPrice');
  if (regularPrice !== undefined) product.regularPrice = regularPrice;
  const salePrice = getField(draft, 'salePrice');
  if (salePrice !== undefined) product.salePrice = salePrice;
  const inStock = getField(draft, 'inStock');
  if (inStock !== undefined) product.inStock = inStock;
  const stockQuantity = getField(draft, 'stockQuantity');
  if (stockQuantity !== undefined) product.stockQuantity = stockQuantity;
  const tags = getField(draft, 'tags');
  if (tags !== undefined) product.tags = tags;
  const weight = getField(draft, 'weight');
  if (weight !== undefined) product.weight = weight;
  const dimensions = getField(draft, 'dimensions');
  if (dimensions !== undefined) product.dimensions = dimensions;
  const brand = getField(draft, 'brand');
  if (brand !== undefined) product.brand = brand;
  const gtin = getField(draft, 'gtin');
  if (gtin !== undefined) product.gtin = gtin;

  return product;
}

/**
 * Finalize a draft and its variations into export order: the parent row
 * immediately followed by its own variation rows (CLAUDE.md §7.4).
 *
 * Variations inherit the parent's `sourceUrl` even when the markup gave them
 * their own. `assignSkus` links a variation with no `parentSku` to the parent
 * sharing its URL, and the parent's SKU may not exist yet at this point.
 */
export function flattenDraft(
  draft: ProductDraft,
  options: DraftToProductOptions
): CanonicalProduct[] {
  const parent = draftToProduct(draft, options);
  if (parent === undefined) return [];

  if (draft.variants.length === 0) return [parent];

  parent.kind = 'variable';

  const rows: CanonicalProduct[] = [parent];
  for (const variantDraft of draft.variants) {
    const resolved: ProductDraft = {
      ...variantDraft,
      sourceUrl: parent.sourceUrl,
      values: { ...variantDraft.values },
    };

    // A `hasVariant` entry rarely carries a name — it is the same product in a
    // different size. WooCommerce shows the parent's title on variations, so
    // inheriting it is both correct and necessary: a nameless draft is dropped.
    const parentName = draft.values.name;
    if (resolved.values.name === undefined && parentName !== undefined) {
      resolved.values.name = parentName;
    }

    const variant = draftToProduct(resolved, options);
    if (variant === undefined) continue;

    variant.kind = 'variation';
    if (parent.sku !== undefined) variant.parentSku = parent.sku;
    rows.push(variant);
  }

  return rows;
}
