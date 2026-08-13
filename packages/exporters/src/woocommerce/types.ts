import type { ContentMode, CurrencyUnit, DimensionUnit, WeightUnit } from '@proc123/core';

import type { CsvOptions } from '../csv.js';
import type { WooColumnKey } from './columns.js';

export type WooExportWarningCode =
  /** An `IRR` price carried no toman/rial unit, so the configured unit was assumed. */
  | 'currency-unit-assumed'
  /** A price is in a currency the export is not configured for; no rate exists to convert it. */
  | 'currency-mismatch'
  /** A generated SKU collided and was given a numeric suffix. */
  | 'sku-deduplicated'
  /** A variation's parent is not in this export; the row was dropped or kept per options. */
  | 'orphan-variation'
  /** A variation names an attribute the parent does not have. */
  | 'variation-attribute-not-on-parent'
  /** A variation's value differed only cosmetically and was aligned to the parent's spelling. */
  | 'variation-value-normalized'
  /** A variation's value was missing from the parent's option list and was added to it. */
  | 'variation-value-added-to-parent'
  /** As above, but repair was disabled — the variation will not work in WooCommerce. */
  | 'variation-value-not-on-parent'
  /** A variation supplied several values for one axis; WooCommerce keeps only the first. */
  | 'variation-multiple-values'
  /** A product with variation rows was not marked `variable`; the Type cell was corrected. */
  | 'parent-type-corrected'
  /** A `variable` product has no variation rows. */
  | 'variable-without-variations'
  /** `inStock` was unknown; an empty cell would import as *out of stock*, so a value was written. */
  | 'stock-status-assumed'
  /** A category name contains ` > `, which WooCommerce will read as a hierarchy separator. */
  | 'category-separator-in-name';

export interface WooExportWarning {
  code: WooExportWarningCode;
  message: string;
  sku?: string;
  sourceUrl?: string;
}

export interface WooExportStats {
  simple: number;
  variable: number;
  variation: number;
  /** SKUs invented because the source had none. */
  skusGenerated: number;
  skusDeduplicated: number;
  attributeColumns: number;
  /**
   * How prices were quoted, e.g. `{ toman: 42, unknown: 5 }`. Surface this in
   * the UI before export so the user can confirm the unit (CLAUDE.md §7.8).
   */
  currencyUnits: Record<string, number>;
}

export interface WooCsvExportResult {
  /** The complete file, BOM included when enabled. */
  csv: string;
  columns: string[];
  /** Data rows, excluding the header. */
  rowCount: number;
  warnings: WooExportWarning[];
  stats: WooExportStats;
}

export interface WooCsvOptions extends CsvOptions {
  /** ISO code the export is denominated in. Default `IRR`. */
  currencyCode?: string;
  /**
   * Unit prices are written in. Prices carrying the other unit are converted;
   * prices carrying none are assumed to already be in this unit and warned about.
   */
  displayUnit?: CurrencyUnit;
  /** Throw on an `IRR` price with no unit instead of assuming `displayUnit`. */
  strictCurrencyUnit?: boolean;

  /**
   * Must match the target store's `woocommerce_weight_unit` /
   * `woocommerce_dimension_unit` settings — WooCommerce builds the column
   * header from them, and a mismatched header will not auto-map.
   */
  weightUnit?: WeightUnit;
  dimensionUnit?: DimensionUnit;

  /** Default `structured-only`. See CLAUDE.md §8. */
  contentMode?: ContentMode;
  /** Tag each row with its source URL in a meta column. Defaults on in `reference` mode. */
  sourceUrlMeta?: boolean;

  /**
   * `Attribute N global`. Default `0` (local attributes): `1` requires the
   * taxonomy to already exist on the target store. See CLAUDE.md §7.7.
   */
  attributesGlobal?: boolean;
  /** `Attribute N visible`. Default `1`. */
  attributesVisible?: boolean;
  /** Align variation values to the parent's option list, adding missing ones. Default `true`. */
  repairVariationValues?: boolean;

  skuPrefix?: string;
  /** Force generated SKUs to ASCII. Default `false`. */
  asciiSkus?: boolean;

  /** `Published` cell. Default `1`. Never emitted empty — empty imports as *draft*. */
  publishedValue?: 1 | 0 | -1 | 2;
  /** Value used when `inStock` is unknown. Default `true`. */
  defaultInStock?: boolean;

  /** Keep variation rows whose parent is missing. Default `drop`. */
  onOrphanVariation?: 'drop' | 'keep';

  /** Emit `GTIN, UPC, EAN, or ISBN`. Off by default: needs manual mapping on import. */
  includeGtin?: boolean;
  /** Emit `Brands`. Off by default: needs manual mapping on import. */
  includeBrand?: boolean;

  /** Opt-in localized headers. See CLAUDE.md §7.1. */
  headerOverrides?: Partial<Record<WooColumnKey, string>>;

  /** Escape a literal `\n` in descriptions so the importer does not make it a newline. */
  escapeDescriptionNewlines?: boolean;
}
