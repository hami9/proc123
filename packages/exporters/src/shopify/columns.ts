/**
 * Shopify product CSV columns.
 *
 * Taken from the template Shopify itself publishes at
 * `help.shopify.com/csv/product_template.csv`, in that file's order. That is a
 * deliberate choice over the header names most third-party guides still show
 * (`Handle`, `Body (HTML)`, `Variant Price`, …): Shopify renamed these, and the
 * template is the artifact their own exporter produces, so a file matching it
 * is one their importer round-trips by construction.
 *
 * Only the columns proc123 can honestly fill are emitted. The Google Shopping
 * block, unit-price measures, metafields and tax codes are all real columns
 * that a category page cannot tell us anything about, and a blank column is
 * noise a user has to scroll past on every row.
 */

/** Stable keys, so header text can move without call sites changing. */
export type ShopifyColumnKey =
  | 'title'
  | 'handle'
  | 'description'
  | 'vendor'
  | 'productCategory'
  | 'type'
  | 'tags'
  | 'published'
  | 'status'
  | 'sku'
  | 'barcode'
  | 'option1Name'
  | 'option1Value'
  | 'option2Name'
  | 'option2Value'
  | 'option3Name'
  | 'option3Value'
  | 'price'
  | 'compareAtPrice'
  | 'chargeTax'
  | 'inventoryTracker'
  | 'inventoryQuantity'
  | 'inventoryPolicy'
  | 'weightGrams'
  | 'weightUnit'
  | 'requiresShipping'
  | 'imageSrc'
  | 'imagePosition'
  | 'imageAlt'
  | 'variantImage';

/** Header text, exactly as the official template spells it. */
export const SHOPIFY_HEADERS: Readonly<Record<ShopifyColumnKey, string>> = {
  title: 'Title',
  handle: 'URL handle',
  description: 'Description',
  vendor: 'Vendor',
  productCategory: 'Product category',
  type: 'Type',
  tags: 'Tags',
  published: 'Published on online store',
  status: 'Status',
  sku: 'SKU',
  barcode: 'Barcode',
  option1Name: 'Option1 name',
  option1Value: 'Option1 value',
  option2Name: 'Option2 name',
  option2Value: 'Option2 value',
  option3Name: 'Option3 name',
  option3Value: 'Option3 value',
  price: 'Price',
  compareAtPrice: 'Compare-at price',
  chargeTax: 'Charge tax',
  inventoryTracker: 'Inventory tracker',
  inventoryQuantity: 'Inventory quantity',
  inventoryPolicy: 'Continue selling when out of stock',
  weightGrams: 'Weight value (grams)',
  weightUnit: 'Weight unit for display',
  requiresShipping: 'Requires shipping',
  imageSrc: 'Product image URL',
  imagePosition: 'Image position',
  imageAlt: 'Image alt text',
  variantImage: 'Variant image URL',
};

/** Column order, as in the template. */
export const SHOPIFY_COLUMNS: readonly ShopifyColumnKey[] = [
  'title',
  'handle',
  'description',
  'vendor',
  'productCategory',
  'type',
  'tags',
  'published',
  'status',
  'sku',
  'barcode',
  'option1Name',
  'option1Value',
  'option2Name',
  'option2Value',
  'option3Name',
  'option3Value',
  'price',
  'compareAtPrice',
  'chargeTax',
  'inventoryTracker',
  'inventoryQuantity',
  'inventoryPolicy',
  'weightGrams',
  'weightUnit',
  'requiresShipping',
  'imageSrc',
  'imagePosition',
  'imageAlt',
  'variantImage',
];

/**
 * Columns Shopify reads only from a product's **first** row.
 *
 * Repeating them on every variant row is not merely redundant: Shopify treats
 * later rows of a handle as variants and images, and a second `Title` is at
 * best ignored and at worst read as a competing product definition. The
 * exporter uses this set to blank them, rather than each call site remembering.
 */
export const FIRST_ROW_ONLY: ReadonlySet<ShopifyColumnKey> = new Set([
  'title',
  'description',
  'vendor',
  'productCategory',
  'type',
  'tags',
  'published',
  'status',
  'option1Name',
  'option2Name',
  'option3Name',
]);

/** Shopify's hard ceiling. A product cannot vary on more than three axes. */
export const MAX_OPTIONS = 3;

/**
 * What a product with no options is called.
 *
 * Shopify's documented convention: "If a product has only one option, then this
 * value should be `Default Title`." A simple product still needs a variant row,
 * because price and stock live on the variant, not the product.
 */
export const DEFAULT_OPTION_NAME = 'Title';
export const DEFAULT_OPTION_VALUE = 'Default Title';

export function shopifyHeaderRow(columns: readonly ShopifyColumnKey[] = SHOPIFY_COLUMNS): string[] {
  return columns.map((key) => SHOPIFY_HEADERS[key]);
}
