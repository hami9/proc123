/**
 * WooCommerce product CSV exporter.
 *
 * Every rule in CLAUDE.md §7 is implemented here and covered by
 * `test/woocommerce.test.ts`. Rules that came from reading WooCommerce's
 * importer source rather than the brief are marked `[verified]` and written up
 * in docs/woocommerce-csv-notes.md.
 */

import {
  type CanonicalProduct,
  type CurrencyUnit,
  type Money,
  assignSkus,
  cleanText,
  convertCurrencyUnit,
  convertDimension,
  convertWeight,
  formatDecimal,
  hasUnit,
  isIranianCurrency,
} from '@proc123/core';

import { toCsv } from '../csv.js';
import { alignAttributes, type AttributeSlot } from './attributes.js';
import {
  SOURCE_URL_META_COLUMN,
  attributeHeaders,
  columnHeader,
  type WooColumnKey,
} from './columns.js';
import type {
  WooCsvExportResult,
  WooCsvOptions,
  WooExportWarning,
  WooExportStats,
} from './types.js';
import { escapeDescription, formatBoolean, formatCategoryPath, joinMultiValue } from './values.js';

/** Column order mirrors WooCommerce's own export, minus what we cannot know. */
const BASE_COLUMNS: readonly WooColumnKey[] = [
  'id',
  'type',
  'sku',
  'gtin',
  'name',
  'published',
  'featured',
  'catalogVisibility',
  'shortDescription',
  'description',
  'stockStatus',
  'stock',
  'weight',
  'length',
  'width',
  'height',
  'salePrice',
  'regularPrice',
  'categories',
  'tags',
  'images',
  'parent',
  'position',
  'brands',
];

interface ResolvedOptions {
  currencyCode: string;
  displayUnit: CurrencyUnit;
  strictCurrencyUnit: boolean;
  weightUnit: NonNullable<WooCsvOptions['weightUnit']>;
  dimensionUnit: NonNullable<WooCsvOptions['dimensionUnit']>;
  contentMode: NonNullable<WooCsvOptions['contentMode']>;
  sourceUrlMeta: boolean;
  attributesGlobal: boolean;
  attributesVisible: boolean;
  repairVariationValues: boolean;
  publishedValue: number;
  defaultInStock: boolean;
  onOrphanVariation: 'drop' | 'keep';
  includeGtin: boolean;
  includeBrand: boolean;
  escapeDescriptionNewlines: boolean;
}

function resolve(options: WooCsvOptions): ResolvedOptions {
  const contentMode = options.contentMode ?? 'structured-only';
  return {
    currencyCode: options.currencyCode ?? 'IRR',
    displayUnit: options.displayUnit ?? 'toman',
    strictCurrencyUnit: options.strictCurrencyUnit ?? false,
    weightUnit: options.weightUnit ?? 'kg',
    dimensionUnit: options.dimensionUnit ?? 'cm',
    contentMode,
    sourceUrlMeta: options.sourceUrlMeta ?? contentMode === 'reference',
    attributesGlobal: options.attributesGlobal ?? false,
    attributesVisible: options.attributesVisible ?? true,
    repairVariationValues: options.repairVariationValues ?? true,
    publishedValue: options.publishedValue ?? 1,
    defaultInStock: options.defaultInStock ?? true,
    onOrphanVariation: options.onOrphanVariation ?? 'drop',
    includeGtin: options.includeGtin ?? false,
    includeBrand: options.includeBrand ?? false,
    escapeDescriptionNewlines: options.escapeDescriptionNewlines ?? true,
  };
}

interface Group {
  parent: CanonicalProduct;
  variations: CanonicalProduct[];
}

export function exportWooCommerceCsv(
  input: readonly CanonicalProduct[],
  options: WooCsvOptions = {}
): WooCsvExportResult {
  const resolved = resolve(options);
  const warnings: WooExportWarning[] = [];

  const skuOptions = {
    ascii: options.asciiSkus ?? false,
    ...(options.skuPrefix === undefined ? {} : { prefix: options.skuPrefix }),
  };

  const assignment = assignSkus(input, {
    ...skuOptions,
    onDuplicate: ({ sku, replacement, sourceUrl }) => {
      warnings.push({
        code: 'sku-deduplicated',
        message: `SKU "${sku}" was already used; this row was exported as "${replacement}".`,
        sku: replacement,
        sourceUrl,
      });
    },
  });

  const { groups, orphans } = groupProducts(assignment.products);

  for (const orphan of orphans) {
    warnings.push({
      code: 'orphan-variation',
      message:
        resolved.onOrphanVariation === 'drop'
          ? `Variation "${orphan.sku ?? orphan.name}" has no parent in this export and was dropped. Importing it would create a stray placeholder product.`
          : `Variation "${orphan.sku ?? orphan.name}" has no parent in this export; WooCommerce will create a placeholder product for it.`,
      ...(orphan.sku === undefined ? {} : { sku: orphan.sku }),
      sourceUrl: orphan.sourceUrl,
    });
  }

  const rendered = groups.map((group) => renderGroup(group, resolved, warnings));
  const attributeColumns = rendered.reduce((max, item) => Math.max(max, item.slots.length), 0);

  const columns = buildHeader(attributeColumns, resolved, options.headerOverrides ?? {});
  const rows: string[][] = [[...columns]];

  for (const item of rendered) {
    for (const cells of item.rows) {
      rows.push(padRow(cells, columns.length));
    }
  }

  if (resolved.onOrphanVariation === 'keep') {
    for (const orphan of orphans) {
      const cells = renderProduct(orphan, {
        resolved,
        warnings,
        slots: [],
        attributeValues: [],
        parentSku: orphan.parentSku ?? '',
        isVariableParent: false,
        position: '',
      });
      rows.push(padRow(cells, columns.length));
    }
  }

  const stats = collectStats(rendered, orphans, resolved, assignment, attributeColumns);

  return {
    csv: toCsv(rows, { bom: options.bom ?? true, ...pickCsvOptions(options) }),
    columns: [...columns],
    rowCount: rows.length - 1,
    warnings,
    stats,
  };
}

function pickCsvOptions(options: WooCsvOptions): {
  delimiter?: string;
  eol?: '\n' | '\r\n';
  escapeFormulas?: boolean;
} {
  return {
    ...(options.delimiter === undefined ? {} : { delimiter: options.delimiter }),
    ...(options.eol === undefined ? {} : { eol: options.eol }),
    ...(options.escapeFormulas === undefined ? {} : { escapeFormulas: options.escapeFormulas }),
  };
}

/**
 * Group variations under their parents, preserving input order.
 *
 * Row order is not cosmetic: WooCommerce fails a variation row whose parent
 * does not exist yet, and falls back to creating a placeholder *simple* product
 * — which then gives the variation no attributes at all. [verified]
 */
function groupProducts(products: readonly CanonicalProduct[]): {
  groups: Group[];
  orphans: CanonicalProduct[];
} {
  const groups: Group[] = [];
  const bySku = new Map<string, Group>();

  for (const product of products) {
    if (product.kind === 'variation') continue;
    const group: Group = { parent: product, variations: [] };
    groups.push(group);
    if (product.sku !== undefined) bySku.set(product.sku, group);
  }

  const orphans: CanonicalProduct[] = [];
  for (const product of products) {
    if (product.kind !== 'variation') continue;
    const group = product.parentSku === undefined ? undefined : bySku.get(product.parentSku);
    if (group === undefined) orphans.push(product);
    else group.variations.push(product);
  }

  return { groups, orphans };
}

interface RenderedGroup {
  rows: string[][];
  slots: AttributeSlot[];
  parent: CanonicalProduct;
  variationCount: number;
}

function renderGroup(
  group: Group,
  resolved: ResolvedOptions,
  warnings: WooExportWarning[]
): RenderedGroup {
  const { parent, variations } = group;
  const aligned = alignAttributes(parent, variations, {
    repairVariationValues: resolved.repairVariationValues,
  });
  warnings.push(...aligned.warnings);

  const isVariableParent = variations.length > 0 || parent.kind === 'variable';

  if (variations.length > 0 && parent.kind !== 'variable') {
    warnings.push({
      code: 'parent-type-corrected',
      message: `"${parent.name}" has variation rows but was marked "${parent.kind}"; exported as "variable" so the variations import.`,
      ...identify(parent),
    });
  }

  if (variations.length === 0 && parent.kind === 'variable') {
    warnings.push({
      code: 'variable-without-variations',
      message: `"${parent.name}" is marked variable but no variations were extracted.`,
      ...identify(parent),
    });
  }

  const rows: string[][] = [
    renderProduct(parent, {
      resolved,
      warnings,
      slots: aligned.slots,
      attributeValues: aligned.slots.map((slot) => slot.values),
      parentSku: '',
      isVariableParent,
      position: '',
    }),
  ];

  variations.forEach((variation, index) => {
    rows.push(
      renderProduct(variation, {
        resolved,
        warnings,
        slots: aligned.slots,
        // Exactly one value per slot on a variation row (CLAUDE.md §7.6).
        attributeValues: aligned.slots.map((_slot, slotIndex) => {
          const value = aligned.variationValues[index]?.[slotIndex];
          return value === undefined ? [] : [value];
        }),
        parentSku: parent.sku ?? '',
        isVariableParent: false,
        position: String(index),
      })
    );
  });

  return { rows, slots: aligned.slots, parent, variationCount: variations.length };
}

interface RenderContext {
  resolved: ResolvedOptions;
  warnings: WooExportWarning[];
  slots: readonly AttributeSlot[];
  attributeValues: readonly string[][];
  parentSku: string;
  isVariableParent: boolean;
  position: string;
}

function renderProduct(product: CanonicalProduct, context: RenderContext): string[] {
  const { resolved, warnings } = context;
  const isVariation = product.kind === 'variation';
  const cells: string[] = [];

  const push = (key: WooColumnKey, value: string): void => {
    if (key === 'gtin' && !resolved.includeGtin) return;
    if (key === 'brands' && !resolved.includeBrand) return;
    cells.push(value);
  };

  // Never carried over: WooCommerce always assigns its own IDs (CLAUDE.md §7.2).
  push('id', '');
  push('type', isVariation ? 'variation' : context.isVariableParent ? 'variable' : 'simple');
  push('sku', product.sku ?? '');
  push('gtin', product.gtin ?? '');
  push('name', cleanText(product.name));
  // Never empty: an empty Published cell imports as a draft. [verified]
  push('published', String(resolved.publishedValue));
  push('featured', '0');
  // Never empty: an empty value throws `product_invalid_catalog_visibility`
  // and fails the whole row. [verified]
  push('catalogVisibility', 'visible');
  push('shortDescription', describe(product.shortDescription, resolved));
  push('description', describe(product.description, resolved));
  push('stockStatus', stockStatus(product, resolved, warnings));
  push('stock', product.stockQuantity === undefined ? '' : formatDecimal(product.stockQuantity));

  push(
    'weight',
    product.weight === undefined
      ? ''
      : formatDecimal(convertWeight(product.weight, resolved.weightUnit))
  );
  for (const axis of ['length', 'width', 'height'] as const) {
    const measure = product.dimensions?.[axis];
    push(
      axis,
      measure === undefined ? '' : formatDecimal(convertDimension(measure, resolved.dimensionUnit))
    );
  }

  // Parent rows of variable products carry empty price cells (CLAUDE.md §7.5).
  const pricesLiveHere = !context.isVariableParent;
  push('salePrice', pricesLiveHere ? price(product.salePrice, product, resolved, warnings) : '');
  push(
    'regularPrice',
    pricesLiveHere ? price(product.regularPrice, product, resolved, warnings) : ''
  );

  push('categories', categories(product, warnings));
  push('tags', joinMultiValue(product.tags ?? []));
  push('images', joinMultiValue(product.images));
  // Variations link to parents by SKU, never by ID (CLAUDE.md §7.2).
  push('parent', isVariation ? context.parentSku : '');
  push('position', context.position);
  push('brands', product.brand ?? '');

  context.slots.forEach((slot, index) => {
    const values = context.attributeValues[index] ?? [];
    const used = values.length > 0;
    cells.push(
      used ? slot.name : '',
      used ? joinMultiValue(values) : '',
      used ? formatBoolean(resolved.attributesVisible) : '',
      used ? formatBoolean(resolved.attributesGlobal) : ''
    );
  });

  if (resolved.sourceUrlMeta) cells.push(product.sourceUrl);

  return cells;
}

function describe(html: string | undefined, resolved: ResolvedOptions): string {
  // `structured-only` is the default: copy data, leave authored content alone.
  if (html === undefined || resolved.contentMode === 'structured-only') return '';
  return resolved.escapeDescriptionNewlines ? escapeDescription(html) : html;
}

function stockStatus(
  product: CanonicalProduct,
  resolved: ResolvedOptions,
  warnings: WooExportWarning[]
): string {
  if (product.inStock !== undefined) return formatBoolean(product.inStock);

  // An empty `In stock?` cell does not mean "unknown" to WooCommerce — it
  // imports as *out of stock*. [verified]
  warnings.push({
    code: 'stock-status-assumed',
    message: `Stock status for "${product.name}" was unknown; exported as ${resolved.defaultInStock ? 'in stock' : 'out of stock'} because an empty cell imports as out of stock.`,
    ...identify(product),
  });
  return formatBoolean(resolved.defaultInStock);
}

function categories(product: CanonicalProduct, warnings: WooExportWarning[]): string {
  for (const segment of product.categoryPath) {
    if (segment.includes('>')) {
      warnings.push({
        code: 'category-separator-in-name',
        message: `Category "${segment}" contains ">", which WooCommerce reads as a hierarchy separator.`,
        ...identify(product),
      });
    }
  }
  return formatCategoryPath(product.categoryPath);
}

function price(
  money: Money | undefined,
  product: CanonicalProduct,
  resolved: ResolvedOptions,
  warnings: WooExportWarning[]
): string {
  if (money === undefined) return '';

  if (!isIranianCurrency(money.currency)) {
    if (money.currency !== '' && money.currency !== resolved.currencyCode) {
      warnings.push({
        code: 'currency-mismatch',
        message: `"${product.name}" is priced in ${money.currency} but the export is denominated in ${resolved.currencyCode}; the amount was written unconverted.`,
        ...identify(product),
      });
    }
    return formatDecimal(money.amount);
  }

  if (!hasUnit(money)) {
    const message = `"${product.name}" has an ${money.currency} price with no toman/rial unit; it was written as ${resolved.displayUnit}. If the source quoted the other unit this price is wrong by 10x.`;
    if (resolved.strictCurrencyUnit) throw new Error(message);

    warnings.push({ code: 'currency-unit-assumed', message, ...identify(product) });
    return formatDecimal(money.amount);
  }

  return formatDecimal(convertCurrencyUnit(money, resolved.displayUnit).amount);
}

function buildHeader(
  attributeColumns: number,
  resolved: ResolvedOptions,
  overrides: Partial<Record<WooColumnKey, string>>
): readonly string[] {
  const units = { weight: resolved.weightUnit, dimension: resolved.dimensionUnit };
  const headers = BASE_COLUMNS.filter(
    (key) => (key !== 'gtin' || resolved.includeGtin) && (key !== 'brands' || resolved.includeBrand)
  ).map((key) => columnHeader(key, units, overrides));

  for (let index = 0; index < attributeColumns; index++) {
    headers.push(...attributeHeaders(index));
  }
  if (resolved.sourceUrlMeta) headers.push(SOURCE_URL_META_COLUMN);

  return headers;
}

/** Groups with fewer attributes than the widest one get empty trailing cells. */
function padRow(cells: readonly string[], width: number): string[] {
  if (cells.length > width) {
    // Truncating here would silently drop data, so fail loudly instead.
    throw new Error(
      `Row has ${String(cells.length)} cells but the header has ${String(width)}; this is a bug in the exporter.`
    );
  }
  const row = [...cells];
  while (row.length < width) row.push('');
  return row;
}

function collectStats(
  rendered: readonly RenderedGroup[],
  orphans: readonly CanonicalProduct[],
  resolved: ResolvedOptions,
  assignment: { generated: number; deduplicated: number; products: readonly CanonicalProduct[] },
  attributeColumns: number
): WooExportStats {
  const stats: WooExportStats = {
    simple: 0,
    variable: 0,
    variation: 0,
    skusGenerated: assignment.generated,
    skusDeduplicated: assignment.deduplicated,
    attributeColumns,
    currencyUnits: {},
  };

  for (const group of rendered) {
    if (group.variationCount > 0 || group.parent.kind === 'variable') stats.variable += 1;
    else stats.simple += 1;
    stats.variation += group.variationCount;
  }
  if (resolved.onOrphanVariation === 'keep') stats.variation += orphans.length;

  for (const product of assignment.products) {
    for (const money of [product.regularPrice, product.salePrice]) {
      if (money === undefined) continue;
      const key = isIranianCurrency(money.currency) ? (money.unit ?? 'unknown') : money.currency;
      stats.currencyUnits[key] = (stats.currencyUnits[key] ?? 0) + 1;
    }
  }

  return stats;
}

function identify(product: CanonicalProduct): { sku?: string; sourceUrl: string } {
  return product.sku === undefined
    ? { sourceUrl: product.sourceUrl }
    : { sku: product.sku, sourceUrl: product.sourceUrl };
}
