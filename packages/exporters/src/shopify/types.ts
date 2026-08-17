import type { ContentMode, CurrencyUnit } from '@proc123/core';

import type { CsvOptions } from '../csv.js';

export type ShopifyExportWarningCode =
  /** An `IRR` price carried no toman/rial unit, so the configured unit was assumed. */
  | 'currency-unit-assumed'
  /** A price is in a currency the export is not configured for; no rate exists to convert it. */
  | 'currency-mismatch'
  /** Two products produced the same handle; the later one was given a suffix. */
  | 'handle-deduplicated'
  /** A variation's parent is not in this export. */
  | 'orphan-variation'
  /**
   * The product varies on more than Shopify's three axes. The extra ones cannot
   * be represented, and dropping them silently would merge distinct variants.
   */
  | 'too-many-options'
  /** A variation supplied no value for an option the parent declares. */
  | 'variation-missing-option-value'
  /** `inStock` was unknown, so an inventory policy had to be chosen. */
  | 'stock-status-assumed'
  /** A product has more images than Shopify accepts in one import. */
  | 'too-many-images'
  /** A weight could not be converted to grams. */
  | 'weight-not-convertible';

export interface ShopifyExportWarning {
  code: ShopifyExportWarningCode;
  message: string;
  handle?: string;
  sourceUrl?: string;
}

export interface ShopifyExportStats {
  products: number;
  variants: number;
  /** Rows carrying nothing but an extra image. */
  imageRows: number;
  handlesDeduplicated: number;
  /** How prices were quoted, e.g. `{ toman: 42, unknown: 5 }` (CLAUDE.md §7.8). */
  currencyUnits: Record<string, number>;
}

export interface ShopifyCsvExportResult {
  csv: string;
  columns: string[];
  /** Data rows, excluding the header. */
  rowCount: number;
  warnings: ShopifyExportWarning[];
  stats: ShopifyExportStats;
}

export interface ShopifyCsvOptions extends CsvOptions {
  /** ISO code the export is denominated in. Default `IRR`. */
  currencyCode?: string;
  /**
   * Unit prices are written in. Prices carrying the other unit are converted;
   * prices carrying none are assumed to be in this unit and warned about.
   */
  displayUnit?: CurrencyUnit;
  /** Throw on an `IRR` price with no unit instead of assuming `displayUnit`. */
  strictCurrencyUnit?: boolean;

  /** Default `structured-only`. See CLAUDE.md §8. */
  contentMode?: ContentMode;

  /** Prefix every handle, for a store importing from several sources. */
  handlePrefix?: string;

  /**
   * `Status`. Default `draft`.
   *
   * Deliberately not `active`: an import of a few hundred scanned products
   * going straight live, with prices nobody has checked, is not something a
   * tool should do on the user's behalf.
   */
  status?: 'active' | 'draft' | 'archived';

  /** `Published on online store`. Default `false`, for the same reason. */
  published?: boolean;

  /** `Vendor`. Shopify shows it on the product page; often the source shop. */
  vendor?: string;

  /**
   * Write `Inventory tracker: shopify` and a quantity.
   *
   * Off by default. A scanned quantity is a snapshot of somebody else's shop,
   * and importing it as tracked inventory means Shopify will stop selling when
   * that borrowed number runs out.
   */
  trackInventory?: boolean;

  /** `Continue selling when out of stock` when stock is unknown. Default `deny`. */
  defaultInventoryPolicy?: 'deny' | 'continue';

  /** `Charge tax`. Default `true`, matching Shopify's own template. */
  chargeTax?: boolean;

  /** `Requires shipping`. Default `true` — these are physical goods. */
  requiresShipping?: boolean;

  /**
   * `Weight unit for display`. Default `g`.
   *
   * Shopify's own set, which is **not** `core`'s `WeightUnit`: Shopify spells
   * pounds `lb` and the canonical model spells them `lbs`. The two are kept
   * separate deliberately — the weight itself is always written in grams, so
   * this only labels how Shopify shows it back to the merchant.
   */
  weightUnit?: 'g' | 'kg' | 'lb' | 'oz';

  /** Keep variation rows whose parent is missing. Default `drop`. */
  onOrphanVariation?: 'drop' | 'keep';
}
