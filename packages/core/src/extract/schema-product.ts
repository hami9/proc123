/**
 * schema.org nodes -> `ProductDraft`s.
 *
 * This is the shared brain of Layer B. JSON-LD hands it parsed nodes and
 * Microdata hands it nodes it built out of the DOM, so the semantics — what
 * `offers` means, how `hasVariant` becomes variation rows, which breadcrumb
 * segments are a category path — are written once and tested once.
 */

import type { ProductAttribute, ProductDimensions } from '../model.js';
import { foldForCompare } from '../text.js';
import { canonicalizeUrl } from '../url.js';
import {
  type JsonObject,
  type JsonValue,
  asArray,
  asNumber,
  asText,
  isJsonObject,
} from './json.js';
import {
  type ProductDraft,
  createDraft,
  getField,
  mergeDraftInto,
  overwriteField,
  setField,
  setPricePair,
} from './draft.js';
import { type MoneyContext, type OfferReading, readOffers } from './schema-offers.js';
import {
  absoluteUrl,
  isProductGroup,
  isProductNode,
  isType,
  nodeUrl,
  normalizeType,
  readAdditionalProperties,
  readCategoryPath,
  readDimension,
  readGtin,
  readImages,
  readKeywords,
  readName,
  readWeight,
} from './schema-values.js';
import { type ExtractionIssue, type ExtractionSource } from './types.js';

export interface SchemaContext extends MoneyContext {
  /** Absolute URL of the page, for resolving relative links. */
  pageUrl: string;
  source: ExtractionSource;
  /** Confidence for a property stated directly on a node. */
  confidence: number;
  /** Confidence for a value inferred from the markup rather than stated. */
  derivedConfidence: number;
  /** Confidence for a value that is known to be approximate. */
  weakConfidence: number;
  issues: ExtractionIssue[];
  /** Follow an `@id` reference to the node it names. */
  resolve: (value: JsonValue | undefined) => JsonValue | undefined;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function readDimensions(node: JsonObject): ProductDimensions | undefined {
  // schema.org calls the third axis `depth`; WooCommerce calls it length.
  const length = readDimension(node['depth'] ?? node['length']);
  const width = readDimension(node['width']);
  const height = readDimension(node['height']);
  if (length === undefined && width === undefined && height === undefined) return undefined;

  const dimensions: ProductDimensions = {};
  if (length !== undefined) dimensions.length = length;
  if (width !== undefined) dimensions.width = width;
  if (height !== undefined) dimensions.height = height;
  return dimensions;
}

function reportPriceIssues(draft: ProductDraft, reading: OfferReading, ctx: SchemaContext): void {
  const price = reading.regularPrice;
  if (price === undefined) return;

  if (reading.priceIsRange && reading.priceRange !== undefined) {
    ctx.issues.push({
      severity: 'info',
      code: 'price-range-only',
      field: 'regularPrice',
      source: ctx.source,
      url: draft.sourceUrl,
      message:
        `The page published a price range (${String(reading.priceRange.low)}–` +
        `${String(reading.priceRange.high)}), not a single price. The lowest was used; ` +
        `open the product page to get the exact one.`,
    });
  }

  if (reading.ambiguousGrouping) {
    ctx.issues.push({
      severity: 'warning',
      code: 'price-separator-ambiguous',
      field: 'regularPrice',
      source: ctx.source,
      url: draft.sourceUrl,
      message:
        `The price separator could be read as thousands or as a decimal point; ` +
        `it was read as thousands, giving ${String(price.amount)}.`,
    });
  }

  if (price.currency === '') {
    ctx.issues.push({
      severity: 'warning',
      code: 'price-currency-missing',
      field: 'regularPrice',
      source: ctx.source,
      url: draft.sourceUrl,
      message: 'The markup gave a price with no currency. Set one before exporting.',
    });
  } else if (price.currency.toUpperCase() === 'IRR' && price.unit === undefined) {
    ctx.issues.push({
      severity: 'warning',
      code: 'price-unit-unknown',
      field: 'regularPrice',
      source: ctx.source,
      url: draft.sourceUrl,
      message:
        'The price is in IRR but the page did not say toman or rial. Confirm the unit ' +
        'before exporting — reading one as the other is a 10x error.',
    });
  }
}

/** Map one Product / ProductGroup node, without following `hasVariant`. */
function mapProductFields(node: JsonObject, ctx: SchemaContext): ProductDraft {
  const url = nodeUrl(node, ctx.pageUrl) ?? ctx.pageUrl;
  const draft = createDraft(canonicalizeUrl(url));
  const { confidence, source } = ctx;

  setField(draft, 'name', asText(node['name']), confidence, source);
  setField(draft, 'sku', asText(node['sku']), confidence, source);
  setField(draft, 'description', asText(node['description']), confidence, source);
  setField(
    draft,
    'shortDescription',
    asText(node['disambiguatingDescription']) ?? asText(node['abstract']),
    confidence,
    source
  );
  setField(draft, 'gtin', readGtin(node), confidence, source);
  setField(
    draft,
    'brand',
    readName(ctx.resolve(node['brand'])) ?? readName(ctx.resolve(node['manufacturer'])),
    confidence,
    source
  );
  setField(draft, 'images', readImages(node['image'], ctx.pageUrl), confidence, source);
  setField(draft, 'categoryPath', readCategoryPath(node['category']), confidence, source);
  setField(draft, 'tags', readKeywords(node['keywords']), confidence, source);
  setField(draft, 'weight', readWeight(node['weight']), confidence, source);
  setField(draft, 'dimensions', readDimensions(node), confidence, source);
  setField(
    draft,
    'attributes',
    readAdditionalProperties(node['additionalProperty']),
    confidence,
    source
  );

  const offers = readOffers(resolveAll(node['offers'], ctx), ctx);
  if (offers !== undefined) {
    const priceConfidence = offers.priceIsRange ? ctx.weakConfidence : confidence;
    setPricePair(
      draft,
      { regular: offers.regularPrice, sale: offers.salePrice },
      priceConfidence,
      source
    );
    setField(draft, 'inStock', offers.inStock, confidence, source);
    setField(draft, 'stockQuantity', offers.stockQuantity, confidence, source);
    // Only used when the product node itself had no SKU; the earlier `setField`
    // wins the tie, which is the right precedence.
    setField(draft, 'sku', offers.sku, confidence, source);
    reportPriceIssues(draft, offers, ctx);
  }

  return draft;
}

/** Resolve every member of a possibly-array property through `@id` references. */
function resolveAll(value: JsonValue | undefined, ctx: SchemaContext): JsonValue[] {
  return asArray(value)
    .map((entry) => ctx.resolve(entry))
    .filter((entry): entry is JsonValue => entry !== undefined);
}

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------

/**
 * schema.org properties that are variation axes when a `ProductGroup` does not
 * spell out `variesBy`. Anything else has to be declared.
 */
const IMPLICIT_AXES = ['color', 'size', 'material', 'pattern', 'flavor'];

function axisLabel(axis: string): string {
  // Only touch bare ASCII schema property names; a name that came from the
  // store's own `additionalProperty` keeps its spelling exactly.
  if (!/^[a-z][a-z0-9]*$/.test(axis)) return axis;
  return axis.charAt(0).toUpperCase() + axis.slice(1);
}

function axisNames(group: JsonObject, variants: readonly JsonObject[]): string[] {
  const declared = asArray(group['variesBy'])
    .map((entry) => (isJsonObject(entry) ? readName(entry) : asText(entry)))
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => normalizeType(entry));
  if (declared.length > 0) return [...new Set(declared)];

  const found: string[] = [];
  for (const variant of variants) {
    for (const axis of IMPLICIT_AXES) {
      if (variant[axis] !== undefined && !found.includes(axis)) found.push(axis);
    }
    for (const property of readAdditionalProperties(variant['additionalProperty'])) {
      if (!found.includes(property.name)) found.push(property.name);
    }
  }
  return found;
}

/** The value a single variant takes on one axis, wherever the markup put it. */
function axisValue(variant: JsonObject, axis: string, ctx: SchemaContext): string | undefined {
  const direct = ctx.resolve(variant[axis]);
  if (direct !== undefined) {
    const text = isJsonObject(direct) ? readName(direct) : asText(direct);
    if (text !== undefined) return text;
  }

  const folded = foldForCompare(axis);
  for (const property of readAdditionalProperties(variant['additionalProperty'])) {
    if (foldForCompare(property.name) === folded) return property.values[0];
  }

  return undefined;
}

/**
 * Attach variation rows to a `ProductGroup` draft.
 *
 * The parent's option list is built from the variants' own values, so the two
 * match character-for-character by construction — CLAUDE.md §7.6, and the
 * single most common way a variable-product import silently loses variations.
 */
function attachVariants(group: JsonObject, draft: ProductDraft, ctx: SchemaContext): void {
  const variants = resolveAll(group['hasVariant'], ctx).filter(isJsonObject);
  if (variants.length === 0) return;

  const axes = axisNames(group, variants);
  const parentValues = new Map<string, string[]>();

  for (const variantNode of variants) {
    const variantDraft = mapProductFields(variantNode, ctx);
    setField(variantDraft, 'kind', 'variation', ctx.confidence, ctx.source);

    const variantAttributes: ProductAttribute[] = [];
    for (const axis of axes) {
      const value = axisValue(variantNode, axis, ctx);
      if (value === undefined) continue;

      const label = axisLabel(axis);
      variantAttributes.push({ name: label, values: [value], isVariationAxis: true });

      const collected = parentValues.get(label) ?? [];
      if (!collected.includes(value)) collected.push(value);
      parentValues.set(label, collected);
    }

    // A variation row carries exactly one value per axis and nothing else:
    // spec-table properties belong on the parent.
    overwriteField(variantDraft, 'attributes', variantAttributes, ctx.confidence, ctx.source);
    draft.variants.push(variantDraft);
  }

  const axisAttributes: ProductAttribute[] = [...parentValues].map(([name, values]) => ({
    name,
    values,
    isVariationAxis: true,
  }));

  // Keep the parent's own spec table, minus anything now serving as an axis.
  const axisKeys = new Set(axisAttributes.map((attribute) => foldForCompare(attribute.name)));
  const spec = (getField(draft, 'attributes') ?? []).filter(
    (attribute) => !axisKeys.has(foldForCompare(attribute.name))
  );

  overwriteField(draft, 'attributes', [...axisAttributes, ...spec], ctx.confidence, ctx.source);
  if (axisAttributes.length > 0) {
    setField(draft, 'kind', 'variable', ctx.confidence, ctx.source);
  }
}

export function mapProduct(node: JsonObject, ctx: SchemaContext): ProductDraft {
  const draft = mapProductFields(node, ctx);
  if (isProductGroup(node)) attachVariants(node, draft, ctx);
  return draft;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

interface ListEntry {
  position: number;
  value: JsonValue;
}

/** `itemListElement` in the order the page meant, not the order it serialized. */
function orderedListElements(node: JsonObject, ctx: SchemaContext): JsonValue[] {
  const entries: ListEntry[] = resolveAll(node['itemListElement'], ctx).map((value, index) => {
    const position = isJsonObject(value) ? asNumber(value['position']) : undefined;
    return { position: position ?? index + 1, value };
  });

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.position - b.entry.position || a.index - b.index)
    .map(({ entry }) => entry.value);
}

export interface ListReading {
  /** Product nodes the list described inline. */
  products: JsonObject[];
  /** URLs the list pointed at without describing. */
  urls: string[];
}

/**
 * Read an `ItemList`.
 *
 * A category page publishes one of two shapes: the whole product in each entry,
 * or just a link. The first is a scan result; the second is a work list for the
 * traversal phase.
 */
export function readItemList(node: JsonObject, ctx: SchemaContext): ListReading {
  const products: JsonObject[] = [];
  const urls: string[] = [];

  const addUrl = (raw: string | undefined): void => {
    if (raw !== undefined && !urls.includes(raw)) urls.push(raw);
  };

  for (const element of orderedListElements(node, ctx)) {
    if (typeof element === 'string') {
      addUrl(absoluteUrl(element, ctx.pageUrl));
      continue;
    }
    if (!isJsonObject(element)) continue;

    if (isProductNode(element)) {
      products.push(element);
      continue;
    }

    const item = ctx.resolve(element['item']);
    if (isJsonObject(item)) {
      if (isProductNode(item)) {
        products.push(item);
        continue;
      }
      addUrl(nodeUrl(item, ctx.pageUrl));
      continue;
    }
    if (typeof item === 'string') {
      addUrl(absoluteUrl(item, ctx.pageUrl));
      continue;
    }

    addUrl(absoluteUrl(element['url'], ctx.pageUrl));
  }

  return { products, urls };
}

/** Names a breadcrumb uses for the site root, which is never a category. */
const HOME_NAMES = new Set([
  'home',
  'homepage',
  'index',
  'main',
  'خانه',
  'صفحه اصلی',
  'صفحه نخست',
  'accueil',
  'inicio',
  'startseite',
  'главная',
]);

function isHomeCrumb(name: string, url: string | undefined): boolean {
  if (HOME_NAMES.has(foldForCompare(name))) return true;
  if (url === undefined) return false;
  try {
    return new URL(url).pathname === '/';
  } catch {
    return false;
  }
}

/**
 * Read a `BreadcrumbList` into a category path.
 *
 * The site root is dropped; the product's own crumb is left for the caller to
 * strip, since only the caller knows the product's name.
 */
export function readBreadcrumbPath(node: JsonObject, ctx: SchemaContext): string[] {
  const path: { name: string; url: string | undefined }[] = [];

  for (const element of orderedListElements(node, ctx)) {
    if (!isJsonObject(element)) continue;

    const item = ctx.resolve(element['item']);
    const name = asText(element['name']) ?? (isJsonObject(item) ? readName(item) : undefined);
    if (name === undefined) continue;

    const url = isJsonObject(item)
      ? nodeUrl(item, ctx.pageUrl)
      : absoluteUrl(item ?? element['url'], ctx.pageUrl);
    path.push({ name, url });
  }

  while (path.length > 0) {
    const first = path[0];
    if (first === undefined || !isHomeCrumb(first.name, first.url)) break;
    path.shift();
  }

  return path.map((crumb) => crumb.name);
}

/** Drop the trailing crumb when it is the product itself rather than a category. */
export function trimSelfCrumb(path: readonly string[], productName: string): string[] {
  const last = path[path.length - 1];
  if (last !== undefined && foldForCompare(last) === foldForCompare(productName)) {
    return path.slice(0, -1);
  }
  return [...path];
}

// ---------------------------------------------------------------------------
// Whole-document scan
// ---------------------------------------------------------------------------

/** Guard against a pathological nesting depth while indexing `@id`s. */
const MAX_INDEX_DEPTH = 12;

function indexById(value: JsonValue, index: Map<string, JsonObject>, depth = 0): void {
  if (depth > MAX_INDEX_DEPTH) return;

  if (Array.isArray(value)) {
    for (const entry of value) indexById(entry, index, depth + 1);
    return;
  }
  if (!isJsonObject(value)) return;

  const id = value['@id'];
  // A bare reference is `{ "@id": "..." }` and must not shadow the real node.
  if (typeof id === 'string' && Object.keys(value).length > 1 && !index.has(id)) {
    index.set(id, value);
  }

  for (const entry of Object.values(value)) indexById(entry, index, depth + 1);
}

function makeResolver(index: Map<string, JsonObject>): SchemaContext['resolve'] {
  const resolve = (value: JsonValue | undefined): JsonValue | undefined => {
    if (typeof value === 'string') return index.get(value) ?? value;
    if (Array.isArray(value)) {
      return value.map((entry) => resolve(entry)).filter((entry) => entry !== undefined);
    }
    if (isJsonObject(value)) {
      const id = value['@id'];
      if (typeof id === 'string' && Object.keys(value).length === 1) {
        return index.get(id) ?? value;
      }
    }
    return value;
  };
  return resolve;
}

/** Expand `@graph` containers and arrays into the nodes they hold. */
function flattenGraph(value: JsonValue | undefined, out: JsonObject[], depth = 0): void {
  if (depth > MAX_INDEX_DEPTH) return;

  for (const entry of asArray(value)) {
    if (Array.isArray(entry)) {
      flattenGraph(entry, out, depth + 1);
      continue;
    }
    if (!isJsonObject(entry)) continue;

    const graph = entry['@graph'];
    if (graph !== undefined) {
      flattenGraph(graph, out, depth + 1);
      // A node carrying `@graph` may still describe something itself.
      if (Object.keys(entry).some((key) => key !== '@graph' && key !== '@context')) out.push(entry);
      continue;
    }
    out.push(entry);
  }
}

export interface SchemaScanResult {
  drafts: ProductDraft[];
  discoveredUrls: string[];
  /** The page's breadcrumb trail, before the product's own crumb is trimmed. */
  breadcrumb: string[];
}

export type SchemaScanContext = Omit<SchemaContext, 'resolve'>;

/**
 * Turn every schema.org node found on a page into drafts.
 *
 * Handles the two page shapes Layer B exists for: a product page carrying one
 * `Product` plus a `BreadcrumbList`, and a category page carrying an `ItemList`
 * of either full products or bare links.
 */
export function scanSchemaNodes(
  roots: readonly JsonValue[],
  base: SchemaScanContext
): SchemaScanResult {
  const index = new Map<string, JsonObject>();
  for (const root of roots) indexById(root, index);

  const ctx: SchemaContext = { ...base, resolve: makeResolver(index) };

  const nodes: JsonObject[] = [];
  flattenGraph([...roots], nodes);

  // A `WebPage`/`ItemPage` wrapper is a container, not a product; unwrap it.
  for (const node of [...nodes]) {
    if (isProductNode(node)) continue;
    for (const key of ['mainEntity', 'mainEntityOfPage', 'about'] as const) {
      for (const entry of resolveAll(node[key], ctx)) {
        if (isJsonObject(entry)) nodes.push(entry);
      }
    }
  }

  const productNodes: JsonObject[] = [];
  const discoveredUrls: string[] = [];
  let breadcrumb: string[] = [];

  for (const node of nodes) {
    if (isProductNode(node)) {
      productNodes.push(node);
      continue;
    }
    if (isType(node, 'breadcrumblist')) {
      const path = readBreadcrumbPath(node, ctx);
      if (path.length > breadcrumb.length) breadcrumb = path;
      continue;
    }
    if (isType(node, 'itemlist', 'offercatalog')) {
      const reading = readItemList(node, ctx);
      productNodes.push(...reading.products);
      for (const url of reading.urls) {
        if (!discoveredUrls.includes(url)) discoveredUrls.push(url);
      }
    }
  }

  // Variants reached through `hasVariant` become variation rows under their
  // parent; if `@graph` also lists them at the top level they must not become
  // standalone products as well.
  const consumed = new Set<JsonObject>();
  for (const node of productNodes) {
    if (!isProductGroup(node)) continue;
    for (const variant of resolveAll(node['hasVariant'], ctx)) {
      if (isJsonObject(variant)) consumed.add(variant);
    }
  }

  const drafts: ProductDraft[] = [];
  const byUrl = new Map<string, ProductDraft>();
  const seenNodes = new Set<JsonObject>();

  for (const node of productNodes) {
    if (consumed.has(node) || seenNodes.has(node)) continue;
    seenNodes.add(node);

    const draft = mapProduct(node, ctx);
    const existing = byUrl.get(draft.sourceUrl);
    if (existing === undefined) {
      byUrl.set(draft.sourceUrl, draft);
      drafts.push(draft);
      continue;
    }
    // The same product described twice on one page — a `Product` node plus an
    // `ItemList` entry, typically. Fold them rather than emitting two rows.
    mergeDraftInto(existing, draft);
  }

  const producedUrls = new Set(drafts.map((draft) => draft.sourceUrl));
  const outstanding = discoveredUrls
    .map((url) => canonicalizeUrl(url))
    .filter((url) => !producedUrls.has(url));

  return { drafts, discoveredUrls: [...new Set(outstanding)], breadcrumb };
}
