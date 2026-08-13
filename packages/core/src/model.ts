/**
 * The canonical product model.
 *
 * Every extraction layer (A/B/C/D) produces `CanonicalProduct`, and every
 * exporter consumes only `CanonicalProduct`. Nothing platform-specific may leak
 * into this file — no WooCommerce column names, no Shopify handles, no
 * `__NEXT_DATA__` shapes. See CLAUDE.md §5.
 */

export type ProductKind = 'simple' | 'variable' | 'variation';

/** Which pipeline layer produced a field. See CLAUDE.md §4. */
export type ExtractionLayer = 'A' | 'B' | 'C' | 'D';

/**
 * Iranian stores quote prices in either toman or rial (1 toman = 10 rial) while
 * both are ISO currency `IRR`. Getting this wrong is a silent 10x price error,
 * so the unit is modelled separately from the currency code and is left
 * `undefined` when the page did not state it. See CLAUDE.md §7.8.
 */
export type CurrencyUnit = 'toman' | 'rial';

export type WeightUnit = 'kg' | 'g' | 'lbs' | 'oz';

export type DimensionUnit = 'm' | 'cm' | 'mm' | 'in' | 'yd';

export interface Money {
  amount: number;
  /** ISO 4217 code where known, e.g. `IRR`, `USD`. */
  currency: string;
  /** Only meaningful for `IRR`. `undefined` means "the page did not say". */
  unit?: CurrencyUnit;
}

export interface Measure<U extends string = string> {
  value: number;
  unit: U;
}

export interface ProductAttribute {
  name: string;
  values: string[];
  /** True when this attribute is one of the axes a variable product varies on. */
  isVariationAxis: boolean;
}

export interface ExtractionMeta {
  layer: ExtractionLayer;
  /** Field name -> 0..1 confidence, for the "why is this field empty?" report. */
  fieldConfidence: Record<string, number>;
  /** ISO 8601 timestamp. */
  scannedAt: string;
}

export interface ProductDimensions {
  length?: Measure<DimensionUnit>;
  width?: Measure<DimensionUnit>;
  height?: Measure<DimensionUnit>;
}

export interface CanonicalProduct {
  sourceUrl: string;
  kind: ProductKind;
  /** Generated deterministically when absent — see `assignSkus`. */
  sku?: string;
  /**
   * Variations only. When absent, a variation is linked to the parent that
   * shares its `sourceUrl` (variations of one product live on one page).
   */
  parentSku?: string;
  name: string;
  shortDescription?: string;
  description?: string;
  regularPrice?: Money;
  salePrice?: Money;
  inStock?: boolean;
  stockQuantity?: number;
  /** A single hierarchical path, outermost first: `['آجیل', 'گردو']`. */
  categoryPath: string[];
  images: string[];
  attributes: ProductAttribute[];
  /** Tier 2, best effort. */
  tags?: string[];
  weight?: Measure<WeightUnit>;
  dimensions?: ProductDimensions;
  brand?: string;
  gtin?: string;
  extractionMeta: ExtractionMeta;
}

/**
 * How much of a product's authored content may be copied into the export.
 * `structured-only` is the default and must stay the default — see CLAUDE.md §8.
 */
export type ContentMode = 'structured-only' | 'reference' | 'rewrite';

export const isVariation = (product: CanonicalProduct): boolean => product.kind === 'variation';

export const isParent = (product: CanonicalProduct): boolean => product.kind !== 'variation';
