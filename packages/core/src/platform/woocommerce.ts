/**
 * WooCommerce Store API adapter.
 *
 * `GET /wp-json/wc/store/v1/products` — unauthenticated, public
 * (`permission_callback => '__return_true'`), and the best data this project
 * can get from a WooCommerce store short of database access.
 *
 * Every claim in this file was checked against `woocommerce/woocommerce` trunk
 * rather than the docs; see docs/store-api-notes.md for the file and line
 * references. Four findings shape the code:
 *
 * 1. Prices are integers in the **smallest unit of the currency**, as strings.
 *    `"13500000"` with `currency_minor_unit: 2` is 135000.00. Reading it raw is
 *    a 100x error — an order of magnitude worse than the toman/rial trap.
 * 2. A variable product's `prices` are the **minimum across its variations**,
 *    not a price of its own, so they must not be written to the parent row.
 * 3. A variation's attribute `value` is the term **slug**, while the parent
 *    lists term **names**. Writing both straight out gives a CSV whose
 *    variations match nothing and are silently dropped on import.
 * 4. `currency_prefix` / `currency_suffix` come from the store's own settings,
 *    which is how this adapter can know toman from rial when Layer B cannot.
 */

import { detectCurrency } from '../money.js';
import type { CanonicalProduct, Money, ProductAttribute, ProductKind } from '../model.js';
import { canonicalizeUrl, resolveUrl } from '../url.js';
import { cleanText } from '../text.js';
import {
  type ProductDraft,
  createDraft,
  flattenDraft,
  setField,
  setPricePair,
} from '../extract/draft.js';
import {
  type JsonObject,
  asArray,
  asNumber,
  asObjects,
  asText,
  isJsonObject,
} from '../extract/json.js';
import { CONFIDENCE, type ExtractionIssue } from '../extract/types.js';
import type { CheerioAPI } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';
import { buildUrl, headerNumber, parseJsonResponse } from './http.js';
import { detectPlatforms } from './detect.js';
import type {
  AdapterContext,
  AdapterReading,
  PlatformAdapter,
  PlatformDetection,
} from './types.js';

const STORE_API_PATH = 'wc/store/v1';

/** `Products.php` caps `per_page` at 100 and defaults it to 10. */
const MAX_PER_PAGE = 100;

/** CLAUDE.md §9's example config. */
const DEFAULT_MAX_PAGES = 20;

/** Enough for the great majority of stores; beyond it, paths degrade to the leaf. */
const MAX_CATEGORY_PAGES = 3;

const SOURCE = 'platform-api';
const CONF = CONFIDENCE.platformApi;

// ---------------------------------------------------------------------------
// Endpoint discovery
// ---------------------------------------------------------------------------

/**
 * Where this store's REST API lives.
 *
 * The `<link rel="https://api.w.org/">` head element is authoritative and
 * handles subdirectory installs and non-standard permalinks; `/wp-json/` is
 * only the default.
 */
export function storeApiBase(page: PageContext, $: CheerioAPI): string | undefined {
  const advertised = $('link[rel="https://api.w.org/"]').attr('href');
  const root =
    advertised === undefined ? resolveUrl('/wp-json/', page.url) : resolveUrl(advertised, page.url);
  if (root === undefined) return undefined;

  return `${root.endsWith('/') ? root : `${root}/`}${STORE_API_PATH}`;
}

/** `/product-category/nuts/walnut/` -> `walnut`. */
export function categorySlugFromUrl(url: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return undefined;
  }

  const segments = path.split('/').filter((segment) => segment !== '');
  const marker = segments.findIndex((segment) =>
    ['product-category', 'product_cat', 'category'].includes(segment.toLowerCase())
  );
  if (marker < 0) return undefined;

  // The deepest segment is the category actually being viewed. Trailing
  // `page/2` segments are pagination, not part of the path.
  const rest = segments.slice(marker + 1).filter((segment) => !/^(?:page|\d+)$/i.test(segment));
  return rest[rest.length - 1];
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

interface StoreCurrency {
  code: string;
  minorUnit: number;
  /** The store's own prefix + suffix, which is where a toman/rial word lives. */
  label: string;
}

function readCurrency(prices: JsonObject): StoreCurrency {
  return {
    code: asText(prices['currency_code']) ?? '',
    minorUnit: asNumber(prices['currency_minor_unit']) ?? 2,
    label: `${asText(prices['currency_prefix']) ?? ''} ${asText(prices['currency_suffix']) ?? ''}`,
  };
}

/**
 * Decode one price.
 *
 * `MoneyFormatter` multiplies by `10 ** decimals` on the way out, so this
 * divides by the same. The empty string means "no price", which WooCommerce
 * uses for a product that is not purchasable — it must stay absent, not become
 * zero.
 */
function readMoney(
  raw: unknown,
  currency: StoreCurrency,
  defaultUnit: 'toman' | 'rial' | undefined
): Money | undefined {
  const text = asText(raw as never);
  if (text === undefined) return undefined;

  const minor = Number(text);
  if (!Number.isFinite(minor)) return undefined;

  const amount = minor / 10 ** currency.minorUnit;
  const detected = detectCurrency(currency.label);
  const unit = detected?.unit ?? (currency.code.toUpperCase() === 'IRR' ? defaultUnit : undefined);

  return unit === undefined
    ? { amount, currency: currency.code }
    : { amount, currency: currency.code, unit };
}

// ---------------------------------------------------------------------------
// Product mapping
// ---------------------------------------------------------------------------

/** WooCommerce's product types, mapped onto the canonical three. */
function readKind(type: string | undefined): ProductKind {
  if (type === 'variable') return 'variable';
  if (type === 'variation') return 'variation';
  return 'simple';
}

/**
 * The parent's attribute list, plus the slug -> display-name table a variation
 * needs so its value matches the parent's option character for character.
 */
interface AttributeReading {
  attributes: ProductAttribute[];
  /** `attribute label -> (term slug -> term name)`. */
  termNames: Map<string, Map<string, string>>;
}

function readAttributes(node: JsonObject): AttributeReading {
  const attributes: ProductAttribute[] = [];
  const termNames = new Map<string, Map<string, string>>();

  for (const entry of asObjects(node['attributes'])) {
    const name = asText(entry['name']);
    if (name === undefined) continue;

    const values: string[] = [];
    const slugs = new Map<string, string>();

    for (const term of asObjects(entry['terms'])) {
      const termName = asText(term['name']);
      if (termName === undefined) continue;
      values.push(termName);
      // For a custom (non-taxonomy) attribute the schema sets slug = name, so
      // this lookup is an identity there and a real translation for a global one.
      slugs.set(asText(term['slug']) ?? termName, termName);
    }
    if (values.length === 0) continue;

    attributes.push({ name, values, isVariationAxis: entry['has_variations'] === true });
    termNames.set(name, slugs);
  }

  return { attributes, termNames };
}

function readImages(node: JsonObject, pageUrl: string): string[] {
  const out: string[] = [];
  for (const image of asObjects(node['images'])) {
    const src = asText(image['src']);
    if (src === undefined) continue;
    const resolved = resolveUrl(src, pageUrl);
    if (resolved !== undefined && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/**
 * Build a category path from the flat list the API returns.
 *
 * `categories` is every category the product is in, with no hierarchy, so the
 * tree has to come from `/products/categories` (whose `TermSchema` does expose
 * `parent`). Without it the best available answer is the single deepest name.
 */
function readCategoryPath(node: JsonObject, tree: Map<number, JsonObject> | undefined): string[] {
  const assigned = asObjects(node['categories']);
  if (assigned.length === 0) return [];

  const deepest = assigned.reduce((best, current) => {
    if (tree === undefined) return best;
    return depthOf(asNumber(current['id']), tree) > depthOf(asNumber(best['id']), tree)
      ? current
      : best;
  }, assigned[0] as JsonObject);

  const leafName = asText(deepest['name']);
  if (leafName === undefined) return [];
  if (tree === undefined) return [leafName];

  const path: string[] = [];
  let id = asNumber(deepest['id']);
  const guard = new Set<number>();

  while (id !== undefined && id > 0 && !guard.has(id)) {
    guard.add(id);
    const term = tree.get(id);
    if (term === undefined) break;
    const name = asText(term['name']);
    if (name !== undefined) path.unshift(name);
    id = asNumber(term['parent']);
  }

  return path.length > 0 ? path : [leafName];
}

function depthOf(id: number | undefined, tree: Map<number, JsonObject>): number {
  let depth = 0;
  let current = id;
  const guard = new Set<number>();
  while (current !== undefined && current > 0 && !guard.has(current)) {
    guard.add(current);
    const term = tree.get(current);
    if (term === undefined) break;
    depth += 1;
    current = asNumber(term['parent']);
  }
  return depth;
}

interface MapContext {
  pageUrl: string;
  defaultUnit: 'toman' | 'rial' | undefined;
  tree: Map<number, JsonObject> | undefined;
  issues: ExtractionIssue[];
}

function mapProduct(node: JsonObject, context: MapContext): ProductDraft {
  const permalink = asText(node['permalink']);
  const url =
    permalink === undefined
      ? context.pageUrl
      : (resolveUrl(permalink, context.pageUrl) ?? context.pageUrl);
  const draft = createDraft(canonicalizeUrl(url));

  const type = asText(node['type']);
  const kind = readKind(type);
  setField(draft, 'kind', kind, CONF, SOURCE);

  setField(draft, 'name', asText(node['name']), CONF, SOURCE);
  setField(draft, 'sku', asText(node['sku']), CONF, SOURCE);
  // Descriptions arrive as HTML, which is what both WooCommerce and Shopify
  // accept back. `contentMode` decides whether they are exported at all.
  setField(draft, 'description', asText(node['description']), CONF, SOURCE);
  setField(draft, 'shortDescription', asText(node['short_description']), CONF, SOURCE);
  setField(draft, 'images', readImages(node, context.pageUrl), CONF, SOURCE);
  setField(draft, 'categoryPath', readCategoryPath(node, context.tree), CONF, SOURCE);

  const tags = asObjects(node['tags'])
    .map((tag) => asText(tag['name']))
    .filter((tag): tag is string => tag !== undefined);
  setField(draft, 'tags', tags, CONF, SOURCE);

  const brand = asObjects(node['brands'])[0];
  if (brand !== undefined) setField(draft, 'brand', asText(brand['name']), CONF, SOURCE);

  const { attributes } = readAttributes(node);
  setField(draft, 'attributes', attributes, CONF, SOURCE);

  setField(draft, 'inStock', node['is_in_stock'] === true, CONF, SOURCE);

  const prices = node['prices'];
  if (isJsonObject(prices)) {
    const currency = readCurrency(prices);

    if (kind === 'variable') {
      // `prepare_product_price_response` fills a variable product's prices from
      // `get_variation_regular_price()`, which is the *minimum* across its
      // variations. That is a range summary, not this row's price, and
      // WooCommerce requires variable parents to have empty price cells anyway.
      const range = prices['price_range'];
      if (isJsonObject(range)) {
        const low = readMoney(range['min_amount'], currency, context.defaultUnit);
        const high = readMoney(range['max_amount'], currency, context.defaultUnit);
        if (low !== undefined && high !== undefined) {
          context.issues.push({
            severity: 'info',
            code: 'price-range-only',
            field: 'regularPrice',
            source: SOURCE,
            url: draft.sourceUrl,
            message:
              `This variable product spans ${String(low.amount)}–${String(high.amount)}. ` +
              `The parent row is left without a price, as WooCommerce requires; ` +
              `the real prices are on the variation rows.`,
          });
        }
      }
    } else {
      const regular = readMoney(prices['regular_price'], currency, context.defaultUnit);
      const sale = readMoney(prices['sale_price'], currency, context.defaultUnit);
      const onSale = node['on_sale'] === true;
      setPricePair(draft, { regular, sale: onSale ? sale : undefined }, CONF, SOURCE);

      if (
        regular !== undefined &&
        regular.currency.toUpperCase() === 'IRR' &&
        regular.unit === undefined
      ) {
        context.issues.push({
          severity: 'warning',
          code: 'price-unit-unknown',
          field: 'regularPrice',
          source: SOURCE,
          url: draft.sourceUrl,
          message:
            'The store prices in IRR but its currency symbol does not say toman or rial. ' +
            'Confirm the unit before exporting — reading one as the other is a 10x error.',
        });
      }
    }
  }

  return draft;
}

/**
 * Attach variation rows to a variable parent.
 *
 * Attribute values come from the **parent's** `variations` array rather than
 * from the variation's own `attributes`, because that array pairs each
 * variation id with `{name, value}` where `value` is the raw postmeta value —
 * the term slug for a global attribute. Translating it back through the
 * parent's term table is what keeps the parent's option list and the
 * variation's value byte-identical, which is what WooCommerce matches on.
 *
 * A `null` value means "any" for that axis, and is left off the row so the
 * exported cell is empty — which is exactly how WooCommerce spells "any".
 */
function attachVariations(
  parent: ProductDraft,
  parentNode: JsonObject,
  variationNodes: readonly JsonObject[],
  context: MapContext
): void {
  const { termNames } = readAttributes(parentNode);

  const axesById = new Map<number, ProductAttribute[]>();
  for (const entry of asObjects(parentNode['variations'])) {
    const id = asNumber(entry['id']);
    if (id === undefined) continue;

    const axes: ProductAttribute[] = [];
    for (const pair of asObjects(entry['attributes'])) {
      const name = asText(pair['name']);
      const rawValue = pair['value'];
      if (name === undefined || rawValue === null || rawValue === undefined) continue;

      const slug = asText(rawValue);
      if (slug === undefined) continue;

      const value = termNames.get(name)?.get(slug) ?? cleanText(slug);
      axes.push({ name, values: [value], isVariationAxis: true });
    }
    axesById.set(id, axes);
  }

  for (const node of variationNodes) {
    const id = asNumber(node['id']);
    const draft = mapProduct(node, context);
    setField(draft, 'kind', 'variation', CONF, SOURCE);

    const axes = id === undefined ? undefined : axesById.get(id);
    if (axes !== undefined && axes.length > 0) {
      draft.values.attributes = { value: axes, confidence: CONF, source: SOURCE };
    }

    parent.variants.push(draft);
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchJson(
  context: AdapterContext,
  url: string
): Promise<
  { data: unknown; totalPages: number | undefined; total: number | undefined } | undefined
> {
  const response = await context.http({ url, headers: { accept: 'application/json' } });
  if (response.status < 200 || response.status >= 300) return undefined;

  const data = parseJsonResponse(response);
  if (data === undefined) return undefined;

  return {
    data,
    totalPages: headerNumber(response, 'x-wp-totalpages'),
    total: headerNumber(response, 'x-wp-total'),
  };
}

/**
 * Load the category tree, for building real hierarchical paths.
 *
 * `AbstractTermsRoute` has no `slug` parameter, so there is no way to ask for
 * one category by slug — the list has to be paged and matched here. A naive
 * `?slug=nuts` is not an error, it just returns everything, which is worse.
 */
async function fetchCategoryTree(
  context: AdapterContext,
  base: string
): Promise<Map<number, JsonObject>> {
  const tree = new Map<number, JsonObject>();

  for (let page = 1; page <= MAX_CATEGORY_PAGES; page++) {
    const result = await fetchJson(
      context,
      buildUrl(`${base}/products/categories`, { per_page: MAX_PER_PAGE, page, hide_empty: 'true' })
    );
    if (result === undefined) break;

    const terms = asObjects(result.data as never);
    for (const term of terms) {
      const id = asNumber(term['id']);
      if (id !== undefined) tree.set(id, term);
    }

    const totalPages = result.totalPages ?? 1;
    if (terms.length === 0 || page >= totalPages) break;
  }

  return tree;
}

/**
 * Resolve a category slug that would be misread as a term ID.
 *
 * `ProductQuery` picks its lookup field with `is_numeric($terms[0])`, so a
 * store whose category slug is `2024` gets matched against term IDs and
 * silently returns the wrong products or none. Only that case needs resolving;
 * every other slug can be passed straight through.
 */
function resolveNumericSlug(slug: string, tree: Map<number, JsonObject>): string | undefined {
  for (const [id, term] of tree) {
    if (asText(term['slug']) === slug) return String(id);
  }
  return undefined;
}

export const wooCommerceAdapter: PlatformAdapter = {
  name: 'WooCommerce Store API',
  platform: 'woocommerce',

  detect(page: PageContext, $: CheerioAPI): PlatformDetection | undefined {
    return detectPlatforms(page, $).find((detection) => detection.platform === 'woocommerce');
  },

  async fetchCategory(context: AdapterContext): Promise<AdapterReading> {
    const issues: ExtractionIssue[] = [];
    const empty = (): AdapterReading => ({ products: [], issues, incomplete: true, requests: 0 });

    const base = storeApiBase(context.page, context.$);
    if (base === undefined) return empty();

    const maxPages = Math.max(1, context.options.maxPages ?? DEFAULT_MAX_PAGES);
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, context.options.perPage ?? MAX_PER_PAGE));
    const defaultUnit = context.options.defaultCurrencyUnit;

    const requestedCategory =
      context.options.categoryFilter ?? categorySlugFromUrl(context.page.url);

    // The tree is needed for hierarchical category paths, and for the numeric
    // slug case above. One request for most stores.
    const tree = await fetchCategoryTree(context, base);

    let category = requestedCategory;
    if (category !== undefined && /^\d+$/.test(category)) {
      const resolved = resolveNumericSlug(category, tree);
      if (resolved !== undefined) category = resolved;
    }

    const mapContext: MapContext = {
      pageUrl: context.page.url,
      defaultUnit,
      tree: tree.size > 0 ? tree : undefined,
      issues,
    };

    const drafts: ProductDraft[] = [];
    const variableNodes: { draft: ProductDraft; node: JsonObject }[] = [];
    let incomplete = false;
    let totalPages = 1;

    for (let page = 1; page <= maxPages; page++) {
      const result = await fetchJson(
        context,
        buildUrl(`${base}/products`, { per_page: perPage, page, category })
      );
      if (result === undefined) {
        // Not a block — `polite.ts` would have thrown for that. This is an
        // endpoint that is switched off, which is a normal answer.
        if (page === 1) return empty();
        incomplete = true;
        break;
      }

      const nodes = asObjects(result.data as never);
      if (nodes.length === 0) break;

      totalPages = result.totalPages ?? page;

      for (const node of nodes) {
        const draft = mapProduct(node, mapContext);
        drafts.push(draft);
        if (asText(node['type']) === 'variable') variableNodes.push({ draft, node });
      }

      if (page >= totalPages) break;
      if (page === maxPages && totalPages > maxPages) incomplete = true;
    }

    if (context.options.includeVariations !== false) {
      for (const { draft, node } of variableNodes) {
        const parentId = asNumber(node['id']);
        if (parentId === undefined) continue;
        if (asArray(node['variations']).length === 0) continue;

        const result = await fetchJson(
          context,
          buildUrl(`${base}/products`, {
            type: 'variation',
            parent: parentId,
            per_page: MAX_PER_PAGE,
          })
        );
        if (result === undefined) {
          issues.push({
            severity: 'warning',
            code: 'variations-unavailable',
            url: draft.sourceUrl,
            source: SOURCE,
            message:
              "The store did not return this product's variations, so it would import " +
              'as a variable product nobody can buy. Its row is kept without them.',
          });
          incomplete = true;
          continue;
        }

        attachVariations(draft, node, asObjects(result.data as never), mapContext);
      }
    }

    const scannedAt = context.options.scannedAt ?? new Date().toISOString();
    const products: CanonicalProduct[] = drafts.flatMap((draft) =>
      flattenDraft(draft, { layer: 'A', scannedAt })
    );

    return { products, issues, incomplete, requests: 0 };
  },
};
