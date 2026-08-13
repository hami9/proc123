/**
 * WooCommerce CSV column names.
 *
 * These are the canonical English headers. WooCommerce ships an English
 * fallback mapping (`includes/admin/importers/mappings/default.php`, hooked at
 * priority 100) that is applied *regardless of store locale*, and header
 * matching is case-insensitive, so these auto-map on any store. Localized
 * headers only auto-map on a store in that same locale, which is why they are
 * opt-in via `headerOverrides`. See CLAUDE.md §7.1.
 */

import type { DimensionUnit, WeightUnit } from '@proc123/core';

/** Stable keys for columns whose header text can be overridden. */
export type WooColumnKey =
  | 'id'
  | 'type'
  | 'sku'
  | 'gtin'
  | 'name'
  | 'published'
  | 'featured'
  | 'catalogVisibility'
  | 'shortDescription'
  | 'description'
  | 'stockStatus'
  | 'stock'
  | 'weight'
  | 'length'
  | 'width'
  | 'height'
  | 'salePrice'
  | 'regularPrice'
  | 'categories'
  | 'tags'
  | 'images'
  | 'parent'
  | 'position'
  | 'brands';

/**
 * Fixed headers. Weight and dimension headers carry the target store's unit and
 * are built by `unitColumnHeader`.
 */
const HEADERS: Readonly<
  Record<Exclude<WooColumnKey, 'weight' | 'length' | 'width' | 'height'>, string>
> = {
  id: 'ID',
  type: 'Type',
  sku: 'SKU',
  gtin: 'GTIN, UPC, EAN, or ISBN',
  name: 'Name',
  published: 'Published',
  featured: 'Is featured?',
  catalogVisibility: 'Visibility in catalog',
  shortDescription: 'Short description',
  description: 'Description',
  stockStatus: 'In stock?',
  stock: 'Stock',
  salePrice: 'Sale price',
  regularPrice: 'Regular price',
  categories: 'Categories',
  tags: 'Tags',
  images: 'Images',
  parent: 'Parent',
  position: 'Position',
  brands: 'Brands',
};

/**
 * Columns WooCommerce's importer does *not* auto-map, so they need manual
 * mapping in the import wizard. Both are opt-in for that reason.
 */
export const MANUALLY_MAPPED_COLUMNS: readonly WooColumnKey[] = ['gtin', 'brands'];

export function columnHeader(
  key: WooColumnKey,
  units: { weight: WeightUnit; dimension: DimensionUnit },
  overrides: Partial<Record<WooColumnKey, string>> = {}
): string {
  const override = overrides[key];
  if (override !== undefined) return override;

  switch (key) {
    case 'weight':
      return `Weight (${units.weight})`;
    case 'length':
      return `Length (${units.dimension})`;
    case 'width':
      return `Width (${units.dimension})`;
    case 'height':
      return `Height (${units.dimension})`;
    default:
      return HEADERS[key];
  }
}

/** `Attribute 1 name`, `Attribute 1 value(s)`, `Attribute 1 visible`, `Attribute 1 global`. */
export function attributeHeaders(index: number): readonly string[] {
  const n = index + 1;
  return [
    `Attribute ${n} name`,
    `Attribute ${n} value(s)`,
    `Attribute ${n} visible`,
    `Attribute ${n} global`,
  ];
}

/** Provenance meta column used by `reference` content mode. */
export const SOURCE_URL_META_COLUMN = 'Meta: _proc123_source_url';
