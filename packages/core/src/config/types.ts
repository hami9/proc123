/**
 * `proc123.config.json` — the whole of a scan's settings in one object.
 *
 * The shape is CLAUDE.md §9's, verbatim, including its user-facing field names:
 * `categories` rather than `categoryPath`, `stock` rather than
 * `inStock`/`stockQuantity`. Those names are what a person types into a config
 * file or reads off a checkbox, and translating them to model field names is
 * this module's job rather than theirs.
 *
 * §9 also says: "Everything here must also be settable from the extension
 * popup — most users will never open the JSON." So nothing here may be
 * expressible only as JSON: every option is a scalar, an enum, or a list of
 * enums, because those are the things a checkbox and a number box can express.
 */

import type { ContentMode, CurrencyUnit, ProductKind } from '../model.js';

/**
 * A field a user can ask for or turn off.
 *
 * Structural columns — type, parent, the SKU that links a variation to its
 * parent — are absent on purpose: they are not data about the product, they are
 * what makes the file import at all.
 */
export type TargetField =
  | 'name'
  | 'sku'
  | 'description'
  | 'shortDescription'
  | 'regularPrice'
  | 'salePrice'
  | 'categories'
  | 'images'
  | 'attributes'
  | 'stock'
  | 'tags'
  | 'weight'
  | 'dimensions'
  | 'brand'
  | 'gtin';

export const ALL_TARGET_FIELDS: readonly TargetField[] = [
  'name',
  'sku',
  'description',
  'shortDescription',
  'regularPrice',
  'salePrice',
  'categories',
  'images',
  'attributes',
  'stock',
  'tags',
  'weight',
  'dimensions',
  'brand',
  'gtin',
];

/** Which `CanonicalProduct` properties each user-facing field controls. */
export const FIELD_PROPERTIES: Readonly<Record<TargetField, readonly string[]>> = {
  name: ['name'],
  sku: ['sku'],
  description: ['description'],
  shortDescription: ['shortDescription'],
  regularPrice: ['regularPrice'],
  salePrice: ['salePrice'],
  categories: ['categoryPath'],
  images: ['images'],
  attributes: ['attributes'],
  stock: ['inStock', 'stockQuantity'],
  tags: ['tags'],
  weight: ['weight'],
  dimensions: ['dimensions'],
  brand: ['brand'],
  gtin: ['gtin'],
};

export interface CurrencyConfig {
  /** ISO 4217. The export is denominated in this. */
  code: string;
  /** Only meaningful for IRR, and the setting a 10x error hinges on. */
  displayUnit: CurrencyUnit;
}

export interface PolitenessConfig {
  delayMsBetweenRequests: number;
  maxConcurrent: number;
}

export interface AIProviderConfig {
  name: string;
  model: string;
  /** Off by default. Layer D costs money per token (CLAUDE.md §4). */
  enabled: boolean;
}

export interface Proc123Config {
  targetFields: TargetField[];
  productTypes: ProductKind[];
  /** `آجیل > گردو`, a slug, or empty for the whole store. */
  categoryFilter?: string;
  maxPages: number;
  contentMode: ContentMode;
  currency: CurrencyConfig;
  politeness: PolitenessConfig;
  exporter: string;
  aiProvider: AIProviderConfig;
}

/**
 * What a user supplies: any subset, with the nested objects also partial.
 *
 * Lists are all-or-nothing rather than partial. "Half a list of fields" is not
 * a thing anyone means, and treating one as partial makes its elements
 * possibly-undefined, which is a different bug wearing a type's clothes.
 */
export type PartialConfig = {
  [K in keyof Proc123Config]?: Proc123Config[K] extends readonly unknown[]
    ? Proc123Config[K]
    : Proc123Config[K] extends object
      ? Partial<Proc123Config[K]>
      : Proc123Config[K];
};
