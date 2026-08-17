/**
 * The Shopify product CSV exporter.
 *
 * **The trap this file exists to avoid.** Shopify's two price columns are the
 * inverse of WooCommerce's. WooCommerce has `Regular price` and `Sale price`,
 * and the sale one is optional. Shopify has `Price` — what the customer is
 * actually charged — and `Compare-at price`, the struck-through "was" figure.
 * So a discounted product writes the *sale* price into `Price` and the
 * *regular* one into `Compare-at price`, and a product that is not on sale
 * writes its regular price into `Price` and leaves `Compare-at price` empty.
 *
 * Copying the WooCommerce mapping across would produce a file where either
 * every product is sold at its pre-discount price, or every product in the shop
 * appears to be permanently discounted. Both import cleanly. Neither is
 * noticeable until somebody buys something.
 *
 * **The other structural difference** is that Shopify's rows are not products.
 * One product is a run of consecutive rows sharing a handle: the first carries
 * the product-level fields and the first variant, later rows carry further
 * variants, and rows after those carry nothing but extra images. Blanking the
 * first-row-only columns is not tidiness — a repeated `Title` is at best
 * ignored and at worst read as a competing definition of the same handle.
 */

import {
  type CanonicalProduct,
  type Measure,
  type Money,
  type WeightUnit,
  convertCurrencyUnit,
  convertWeight,
  formatDecimal,
  hasUnit,
  isIranianCurrency,
} from '@proc123/core';

import { toCsv } from '../csv.js';
import {
  DEFAULT_OPTION_NAME,
  DEFAULT_OPTION_VALUE,
  FIRST_ROW_ONLY,
  MAX_OPTIONS,
  SHOPIFY_COLUMNS,
  type ShopifyColumnKey,
  shopifyHeaderRow,
} from './columns.js';
import { assignHandles } from './handle.js';
import type {
  ShopifyCsvExportResult,
  ShopifyCsvOptions,
  ShopifyExportStats,
  ShopifyExportWarning,
} from './types.js';

/** Shopify's documented ceiling. */
const MAX_IMAGES = 250;

interface Resolved {
  currencyCode: string;
  displayUnit: 'toman' | 'rial';
  strictCurrencyUnit: boolean;
  contentMode: 'structured-only' | 'reference' | 'rewrite';
  status: 'active' | 'draft' | 'archived';
  published: boolean;
  vendor: string;
  trackInventory: boolean;
  defaultInventoryPolicy: 'deny' | 'continue';
  chargeTax: boolean;
  requiresShipping: boolean;
  weightUnit: 'g' | 'kg' | 'lb' | 'oz';
  onOrphanVariation: 'drop' | 'keep';
  handlePrefix?: string;
}

function resolve(options: ShopifyCsvOptions): Resolved {
  return {
    currencyCode: options.currencyCode ?? 'IRR',
    displayUnit: options.displayUnit ?? 'toman',
    strictCurrencyUnit: options.strictCurrencyUnit ?? false,
    contentMode: options.contentMode ?? 'structured-only',
    status: options.status ?? 'draft',
    published: options.published ?? false,
    vendor: options.vendor ?? '',
    trackInventory: options.trackInventory ?? false,
    defaultInventoryPolicy: options.defaultInventoryPolicy ?? 'deny',
    chargeTax: options.chargeTax ?? true,
    requiresShipping: options.requiresShipping ?? true,
    weightUnit: options.weightUnit ?? 'g',
    onOrphanVariation: options.onOrphanVariation ?? 'drop',
    ...(options.handlePrefix === undefined ? {} : { handlePrefix: options.handlePrefix }),
  };
}

/**
 * `TRUE` / `FALSE`, and `DENY` / `CONTINUE`.
 *
 * Shopify's documentation writes these lowercase and its importer accepts
 * either, but the template its own exporter produces uses uppercase. Matching
 * the artifact rather than the prose means a file this writes is
 * indistinguishable from one Shopify wrote.
 */
const yesNo = (value: boolean): string => (value ? 'TRUE' : 'FALSE');

type Row = Partial<Record<ShopifyColumnKey, string>>;

interface Group {
  parent: CanonicalProduct;
  variations: CanonicalProduct[];
}

function groupProducts(products: readonly CanonicalProduct[]): {
  groups: Group[];
  orphans: CanonicalProduct[];
} {
  const groups: Group[] = [];
  const bySku = new Map<string, Group>();
  const byUrl = new Map<string, Group>();

  for (const product of products) {
    if (product.kind === 'variation') continue;
    const group: Group = { parent: product, variations: [] };
    groups.push(group);
    if (product.sku !== undefined) bySku.set(product.sku, group);
    // Variations of one product live on one page, so a shared source URL is
    // the fallback link when no parent SKU was published.
    if (!byUrl.has(product.sourceUrl)) byUrl.set(product.sourceUrl, group);
  }

  const orphans: CanonicalProduct[] = [];
  for (const product of products) {
    if (product.kind !== 'variation') continue;
    const group =
      (product.parentSku === undefined ? undefined : bySku.get(product.parentSku)) ??
      byUrl.get(product.sourceUrl);
    if (group === undefined) orphans.push(product);
    else group.variations.push(product);
  }

  return { groups, orphans };
}

/**
 * Which axes this product varies on, in a stable order.
 *
 * Taken from the parent's `isVariationAxis` attributes, falling back to the
 * attribute names the variations actually carry — a Layer B scan often knows a
 * variation's options without the parent having declared them as axes.
 */
function optionNames(group: Group, warnings: ShopifyExportWarning[], handle: string): string[] {
  const declared = group.parent.attributes
    .filter((attribute) => attribute.isVariationAxis)
    .map((attribute) => attribute.name);

  const seen = new Set(declared);
  for (const variation of group.variations) {
    for (const attribute of variation.attributes) {
      if (!seen.has(attribute.name)) {
        seen.add(attribute.name);
        declared.push(attribute.name);
      }
    }
  }

  if (declared.length > MAX_OPTIONS) {
    const dropped = declared.slice(MAX_OPTIONS);
    warnings.push({
      code: 'too-many-options',
      message:
        `"${group.parent.name}" varies on ${String(declared.length)} attributes and Shopify allows ${String(MAX_OPTIONS)}. ` +
        `${dropped.join(', ')} could not be exported, so variants differing only by those are now duplicates.`,
      handle,
      sourceUrl: group.parent.sourceUrl,
    });
  }

  return declared.slice(0, MAX_OPTIONS);
}

function valueFor(product: CanonicalProduct, option: string): string | undefined {
  const attribute = product.attributes.find((entry) => entry.name === option);
  // Shopify takes exactly one value per option per variant. A variation
  // carrying several is a parent-shaped record, and the first is the only
  // answer available.
  return attribute?.values[0];
}

function money(
  value: Money | undefined,
  product: CanonicalProduct,
  resolved: Resolved,
  warnings: ShopifyExportWarning[],
  handle: string
): string {
  if (value === undefined) return '';

  if (!isIranianCurrency(value.currency)) {
    if (value.currency !== '' && value.currency !== resolved.currencyCode) {
      warnings.push({
        code: 'currency-mismatch',
        message: `"${product.name}" is priced in ${value.currency} but the export is denominated in ${resolved.currencyCode}; the amount was written unconverted.`,
        handle,
        sourceUrl: product.sourceUrl,
      });
    }
    return formatDecimal(value.amount);
  }

  if (!hasUnit(value)) {
    const message = `"${product.name}" has an ${value.currency} price with no toman/rial unit; it was written as ${resolved.displayUnit}. If the source quoted the other unit this price is wrong by 10x.`;
    if (resolved.strictCurrencyUnit) throw new Error(message);
    warnings.push({ code: 'currency-unit-assumed', message, handle, sourceUrl: product.sourceUrl });
    return formatDecimal(value.amount);
  }

  return formatDecimal(convertCurrencyUnit(value, resolved.displayUnit).amount);
}

/**
 * The price pair, in Shopify's terms.
 *
 * See the note at the top of this file: `Price` is what is charged, so a sale
 * price belongs there and the regular price becomes the struck-through
 * `Compare-at price`. A product with only a regular price has no compare-at at
 * all — writing the same figure in both makes every product show a 0% discount.
 */
function prices(
  product: CanonicalProduct,
  resolved: Resolved,
  warnings: ShopifyExportWarning[],
  handle: string
): { price: string; compareAtPrice: string } {
  const regular = money(product.regularPrice, product, resolved, warnings, handle);
  const sale = money(product.salePrice, product, resolved, warnings, handle);

  if (sale === '') return { price: regular, compareAtPrice: '' };
  if (regular === '') return { price: sale, compareAtPrice: '' };
  return { price: sale, compareAtPrice: regular };
}

function grams(
  weight: Measure<WeightUnit> | undefined,
  product: CanonicalProduct,
  warnings: ShopifyExportWarning[],
  handle: string
): string {
  if (weight === undefined) return '';

  // `convertWeight` does not throw on a unit it does not know — it multiplies
  // by `undefined` and yields NaN. `NaN` written into the column imports as a
  // zero-weight product, so the check is on the number, not on an exception.
  const converted = convertWeight(weight, 'g');
  if (!Number.isFinite(converted)) {
    warnings.push({
      code: 'weight-not-convertible',
      message: `"${product.name}" has a weight in ${weight.unit}, which could not be converted to grams; it was left empty.`,
      handle,
      sourceUrl: product.sourceUrl,
    });
    return '';
  }
  return formatDecimal(converted);
}

function describe(product: CanonicalProduct, resolved: Resolved): string {
  if (resolved.contentMode === 'structured-only') return '';
  const body = product.description ?? product.shortDescription ?? '';
  if (body === '' || resolved.contentMode !== 'reference') return body;
  // §8: `reference` tags each copied description with where it came from, so a
  // reviewer can see what is somebody else's writing.
  return `${body}\n\n<!-- source: ${product.sourceUrl} -->`;
}

/**
 * Inventory, which is deliberately conservative.
 *
 * A scanned quantity is a snapshot of another shop's stock. Importing it as
 * tracked inventory means Shopify stops selling when a borrowed number runs
 * out, which is a worse failure than not tracking at all — so tracking is
 * opt-in and the default is to leave the tracker empty.
 */
function inventory(
  product: CanonicalProduct,
  resolved: Resolved,
  warnings: ShopifyExportWarning[],
  handle: string
): { tracker: string; quantity: string; policy: string } {
  const inStock = product.inStock;
  if (inStock === undefined) {
    warnings.push({
      code: 'stock-status-assumed',
      message: `"${product.name}" did not say whether it is in stock; it was exported as available, with "${resolved.defaultInventoryPolicy}" when out of stock.`,
      handle,
      sourceUrl: product.sourceUrl,
    });
  }

  if (!resolved.trackInventory) {
    // No tracker means Shopify always considers it available, so the policy
    // column is the only thing carrying the shop's intent.
    return { tracker: '', quantity: '', policy: resolved.defaultInventoryPolicy.toUpperCase() };
  }

  const quantity = product.stockQuantity ?? (inStock === false ? 0 : 1);
  return {
    tracker: 'shopify',
    quantity: String(quantity),
    policy: resolved.defaultInventoryPolicy.toUpperCase(),
  };
}

/** One variant row: the product-level cells are added by the caller. */
function variantRow(
  variant: CanonicalProduct,
  options: readonly string[],
  handle: string,
  resolved: Resolved,
  warnings: ShopifyExportWarning[]
): Row {
  const { price, compareAtPrice } = prices(variant, resolved, warnings, handle);
  const stock = inventory(variant, resolved, warnings, handle);

  const row: Row = {
    handle,
    price,
    compareAtPrice,
    chargeTax: yesNo(resolved.chargeTax),
    requiresShipping: yesNo(resolved.requiresShipping),
    inventoryTracker: stock.tracker,
    inventoryQuantity: stock.quantity,
    inventoryPolicy: stock.policy,
    weightGrams: grams(variant.weight, variant, warnings, handle),
    weightUnit: resolved.weightUnit,
    ...(variant.sku === undefined ? {} : { sku: variant.sku }),
    ...(variant.gtin === undefined ? {} : { barcode: variant.gtin }),
  };

  if (options.length === 0) {
    row.option1Value = DEFAULT_OPTION_VALUE;
    return row;
  }

  const cells: ShopifyColumnKey[] = ['option1Value', 'option2Value', 'option3Value'];
  options.forEach((option, index) => {
    const value = valueFor(variant, option);
    const cell = cells[index];
    if (cell === undefined) return;
    if (value === undefined) {
      warnings.push({
        code: 'variation-missing-option-value',
        message:
          `A variant of "${variant.name}" has no value for "${option}". Shopify needs one for every option, ` +
          `so this variant will not be selectable.`,
        handle,
        sourceUrl: variant.sourceUrl,
      });
      return;
    }
    row[cell] = value;
  });

  return row;
}

export function exportShopifyCsv(
  input: readonly CanonicalProduct[],
  options: ShopifyCsvOptions = {}
): ShopifyCsvExportResult {
  const resolved = resolve(options);
  const warnings: ShopifyExportWarning[] = [];

  const { groups, orphans } = groupProducts(input);
  const { handles, collisions } = assignHandles(
    groups.map((group) => group.parent),
    resolved.handlePrefix === undefined ? {} : { prefix: resolved.handlePrefix }
  );

  if (collisions > 0) {
    warnings.push({
      code: 'handle-deduplicated',
      message:
        `${String(collisions)} product(s) produced a handle another product already had and were given a numbered suffix. ` +
        `Two products sharing a handle would have been merged into one on import.`,
    });
  }

  for (const orphan of orphans) {
    warnings.push({
      code: 'orphan-variation',
      message:
        resolved.onOrphanVariation === 'drop'
          ? `Variation "${orphan.name}" has no parent in this export and was dropped.`
          : `Variation "${orphan.name}" has no parent in this export; it was written as a product of its own.`,
      sourceUrl: orphan.sourceUrl,
    });
  }

  const rows: Row[] = [];
  const stats: ShopifyExportStats = {
    products: 0,
    variants: 0,
    imageRows: 0,
    handlesDeduplicated: collisions,
    currencyUnits: {},
  };

  const tally = (value: Money | undefined): void => {
    if (value === undefined) return;
    const key = isIranianCurrency(value.currency)
      ? (value.unit ?? 'unknown')
      : value.currency === ''
        ? 'unknown'
        : value.currency;
    stats.currencyUnits[key] = (stats.currencyUnits[key] ?? 0) + 1;
  };

  const renderGroup = (group: Group): void => {
    const handle = handles.get(group.parent) ?? '';
    const options = optionNames(group, warnings, handle);

    // A product with variations is exported as its variations; a product
    // without any is its own single variant, because price and stock live on
    // the variant in Shopify's model, never on the product.
    const variants = group.variations.length > 0 ? group.variations : [group.parent];
    stats.products += 1;

    const productCells: Row = {
      title: group.parent.name,
      description: describe(group.parent, resolved),
      vendor: resolved.vendor,
      // `Product category` is Shopify's own taxonomy, and a scanned category
      // path is not in it. Guessing a taxonomy value is worse than leaving it
      // blank — Shopify uses it for tax and marketplace rules.
      productCategory: '',
      type: group.parent.categoryPath.at(-1) ?? '',
      tags: [...group.parent.categoryPath, ...(group.parent.tags ?? [])].join(', '),
      published: yesNo(resolved.published),
      status: resolved.status,
      option1Name: options[0] ?? DEFAULT_OPTION_NAME,
      ...(options[1] === undefined ? {} : { option2Name: options[1] }),
      ...(options[2] === undefined ? {} : { option3Name: options[2] }),
    };

    const images = group.parent.images.slice(0, MAX_IMAGES);
    if (group.parent.images.length > MAX_IMAGES) {
      warnings.push({
        code: 'too-many-images',
        message: `"${group.parent.name}" has ${String(group.parent.images.length)} images; Shopify accepts ${String(MAX_IMAGES)}, so the rest were dropped.`,
        handle,
        sourceUrl: group.parent.sourceUrl,
      });
    }

    variants.forEach((variant, index) => {
      tally(variant.regularPrice);
      tally(variant.salePrice);
      stats.variants += 1;

      const row = variantRow(variant, options, handle, resolved, warnings);
      if (index === 0) {
        Object.assign(row, productCells);
        const first = images[0];
        if (first !== undefined) {
          row.imageSrc = first;
          row.imagePosition = '1';
          row.imageAlt = group.parent.name;
        }
      }
      rows.push(row);
    });

    // Extra images get a row each, carrying nothing but the handle and the
    // image — anything else on these rows would be read as another variant.
    images.slice(1).forEach((image, index) => {
      rows.push({
        handle,
        imageSrc: image,
        imagePosition: String(index + 2),
        imageAlt: group.parent.name,
      });
      stats.imageRows += 1;
    });
  };

  for (const group of groups) renderGroup(group);

  if (resolved.onOrphanVariation === 'keep') {
    for (const orphan of orphans) renderGroup({ parent: orphan, variations: [] });
  }

  const columns = shopifyHeaderRow();

  // Blanking the product-level columns on later rows of a handle is
  // load-bearing rather than tidy — see the note at the top of this file. It is
  // enforced here, once, instead of relying on every row builder above to have
  // remembered not to set them.
  const started = new Set<string>();
  const body = rows.map((row) => {
    const handle = row.handle ?? '';
    const isFirst = !started.has(handle);
    started.add(handle);

    return SHOPIFY_COLUMNS.map((key) => {
      if (!isFirst && FIRST_ROW_ONLY.has(key)) return '';
      return row[key] ?? '';
    });
  });

  const csvOptions = {
    ...(options.bom === undefined ? {} : { bom: options.bom }),
    ...(options.eol === undefined ? {} : { eol: options.eol }),
    ...(options.delimiter === undefined ? {} : { delimiter: options.delimiter }),
    ...(options.escapeFormulas === undefined ? {} : { escapeFormulas: options.escapeFormulas }),
  };

  return {
    csv: toCsv([columns, ...body], csvOptions),
    columns,
    rowCount: body.length,
    warnings,
    stats,
  };
}
