/**
 * Shopify adapter — `GET /collections/{handle}/products.json?limit=250&page=N`.
 *
 * This endpoint is **unofficial**. It is not in Shopify's API documentation,
 * there is no source to check it against, merchants can switch it off, and its
 * pagination is not guaranteed. ROADMAP §6.14 is explicit about the
 * consequence: compare what came back against what the collection says it
 * holds, and fall through to Layer B when they disagree. This adapter is
 * therefore built to be *distrusted* — it reports `incomplete` readily, and the
 * scan is expected to fall back rather than ship a half catalogue.
 *
 * Two shape differences from WooCommerce are worth holding in mind:
 *
 * - Prices are **decimal strings** (`"24.00"`), not minor units. The exact
 *   opposite of the Store API, and mixing the two up is a 100x error in either
 *   direction.
 * - There is **no currency anywhere in the payload**. It has to come off the
 *   page, or from the caller.
 */

import type { CanonicalProduct, Money, ProductAttribute } from '../model.js';
import { parseNumberValue } from '../numbers.js';
import { canonicalizeUrl, resolveUrl } from '../url.js';
import {
  type ProductDraft,
  createDraft,
  flattenDraft,
  setField,
  setPricePair,
} from '../extract/draft.js';
import { type JsonObject, asArray, asNumber, asObjects, asText } from '../extract/json.js';
import type { CheerioAPI } from '../extract/html.js';
import { CONFIDENCE, type ExtractionIssue, type PageContext } from '../extract/types.js';
import { detectPlatforms } from './detect.js';
import { buildUrl, parseJsonResponse } from './http.js';
import type {
  AdapterContext,
  AdapterReading,
  PlatformAdapter,
  PlatformDetection,
} from './types.js';

/** Shopify's own cap on this endpoint. */
const MAX_LIMIT = 250;
const DEFAULT_MAX_PAGES = 20;

const SOURCE = 'platform-api';
const CONF = CONFIDENCE.platformApi;

/** The single option Shopify gives a product that has no real options. */
const DEFAULT_OPTION_VALUE = 'Default Title';

/** `/collections/nuts` or `/collections/nuts/walnut` -> `nuts`. */
export function collectionHandleFromUrl(url: string): string | undefined {
  try {
    const segments = decodeURIComponent(new URL(url).pathname)
      .split('/')
      .filter((segment) => segment !== '');
    const marker = segments.indexOf('collections');
    return marker < 0 ? undefined : segments[marker + 1];
  } catch {
    return undefined;
  }
}

/**
 * The shop's currency, which `products.json` never states.
 *
 * Taken from the `Shopify.currency` global the storefront prints, then from a
 * `currencyCode` in any embedded state, then from the caller's setting.
 */
export function shopCurrency(page: PageContext, fallback: string | undefined): string | undefined {
  const active = /Shopify\.currency\s*=\s*\{[^}]*['"]?active['"]?\s*:\s*['"]([A-Z]{3})['"]/.exec(
    page.html
  );
  if (active?.[1] !== undefined) return active[1];

  const code = /"currencyCode"\s*:\s*"([A-Z]{3})"/.exec(page.html);
  if (code?.[1] !== undefined) return code[1];

  return fallback;
}

/**
 * How many products the collection claims to hold.
 *
 * Only a JSON-LD `ItemList` is read: it is the one count that means the same
 * thing on every theme. A theme-specific "showing 24 of 137" string would be a
 * guess dressed as a check, and a wrong cross-check is worse than none.
 */
export function declaredProductCount($: CheerioAPI): number | undefined {
  let found: number | undefined;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (found !== undefined) return;
    try {
      const data = JSON.parse($(element).text()) as unknown;
      for (const node of asArray(data as never)) {
        if (typeof node !== 'object' || node === null || Array.isArray(node)) continue;
        const count = asNumber(node['numberOfItems']);
        if (count !== undefined && count > 0) {
          found = count;
          return;
        }
      }
    } catch {
      // A broken block here is Layer B's problem, not this adapter's.
    }
  });

  return found;
}

function readPrice(raw: unknown, currency: string | undefined): Money | undefined {
  const text = asText(raw as never);
  if (text === undefined) return undefined;
  // Decimal strings, so a lone separator is a decimal point and never grouping.
  const amount = parseNumberValue(text, { ambiguousGrouping: 'decimal' });
  if (amount === undefined) return undefined;
  return { amount, currency: currency ?? '' };
}

/** `options` names the axes; each variant answers them in `option1..3`. */
function variantAxes(product: JsonObject, variant: JsonObject): ProductAttribute[] {
  const axes: ProductAttribute[] = [];

  asObjects(product['options']).forEach((option, index) => {
    const name = asText(option['name']);
    const value = asText(variant[`option${String(index + 1)}`]);
    if (name === undefined || value === undefined) return;
    axes.push({ name, values: [value], isVariationAxis: true });
  });

  return axes;
}

/** A product with one variant called "Default Title" has no real options. */
function isSingleVariant(product: JsonObject, variants: readonly JsonObject[]): boolean {
  if (variants.length !== 1) return false;
  const options = asObjects(product['options']);
  if (options.length > 1) return false;
  const values = asArray(options[0]?.['values']).map((value) => asText(value));
  return values.length <= 1 && (values[0] === DEFAULT_OPTION_VALUE || values[0] === undefined);
}

export interface MapContext {
  pageUrl: string;
  currency: string | undefined;
  issues: ExtractionIssue[];
}

export function mapShopifyProduct(
  product: JsonObject,
  context: MapContext
): ProductDraft | undefined {
  const handle = asText(product['handle']);
  const title = asText(product['title']);
  if (title === undefined) return undefined;

  const url =
    handle === undefined
      ? context.pageUrl
      : (resolveUrl(`/products/${handle}`, context.pageUrl) ?? context.pageUrl);
  const draft = createDraft(canonicalizeUrl(url));

  setField(draft, 'name', title, CONF, SOURCE);
  setField(draft, 'description', asText(product['body_html']), CONF, SOURCE);
  setField(draft, 'brand', asText(product['vendor']), CONF, SOURCE);

  // `product_type` is Shopify's single-level category, and it is the only
  // category information this endpoint carries.
  const productType = asText(product['product_type']);
  if (productType !== undefined) setField(draft, 'categoryPath', [productType], CONF, SOURCE);

  const tags = asArray(product['tags'])
    .map((tag) => asText(tag))
    .filter((tag): tag is string => tag !== undefined);
  setField(draft, 'tags', tags, CONF, SOURCE);

  const images: string[] = [];
  for (const image of asObjects(product['images'])) {
    const src = asText(image['src']);
    const resolved = src === undefined ? undefined : resolveUrl(src, context.pageUrl);
    if (resolved !== undefined && !images.includes(resolved)) images.push(resolved);
  }
  setField(draft, 'images', images, CONF, SOURCE);

  const variants = asObjects(product['variants']);
  const single = isSingleVariant(product, variants);

  if (single) {
    const variant = variants[0];
    if (variant !== undefined) applyVariantFields(draft, variant, context);
    setField(draft, 'kind', 'simple', CONF, SOURCE);
    return draft;
  }

  // The parent's option list comes from `options[].values`, and each variation
  // answers with the same strings out of `option1..3`, so the two match
  // character for character without any repair.
  const parentAxes: ProductAttribute[] = asObjects(product['options'])
    .map((option) => {
      const name = asText(option['name']);
      const values = asArray(option['values'])
        .map((value) => asText(value))
        .filter((value): value is string => value !== undefined);
      return name === undefined || values.length === 0
        ? undefined
        : { name, values, isVariationAxis: true };
    })
    .filter((axis): axis is ProductAttribute => axis !== undefined);

  setField(draft, 'attributes', parentAxes, CONF, SOURCE);
  setField(draft, 'kind', 'variable', CONF, SOURCE);

  for (const variant of variants) {
    const child = createDraft(draft.sourceUrl);
    setField(child, 'kind', 'variation', CONF, SOURCE);
    setField(child, 'name', title, CONF, SOURCE);
    applyVariantFields(child, variant, context);

    const axes = variantAxes(product, variant);
    if (axes.length > 0) setField(child, 'attributes', axes, CONF, SOURCE);

    draft.variants.push(child);
  }

  return draft;
}

function applyVariantFields(draft: ProductDraft, variant: JsonObject, context: MapContext): void {
  setField(draft, 'sku', asText(variant['sku']), CONF, SOURCE);
  setField(draft, 'inStock', variant['available'] === true, CONF, SOURCE);

  const price = readPrice(variant['price'], context.currency);
  const compareAt = readPrice(variant['compare_at_price'], context.currency);

  // `compare_at_price` is Shopify's "was" price. It is often present and equal
  // to, or below, the current price on products that are not on sale, and
  // `setPricePair` drops the discount in that case rather than inventing one.
  if (compareAt !== undefined && price !== undefined && compareAt.amount > price.amount) {
    setPricePair(draft, { regular: compareAt, sale: price }, CONF, SOURCE);
  } else {
    setPricePair(draft, { regular: price }, CONF, SOURCE);
  }

  const grams = asNumber(variant['grams']);
  // Zero grams means "not weighed", not "weightless"; every digital product and
  // half of the physical ones carry it.
  if (grams !== undefined && grams > 0) {
    setField(draft, 'weight', { value: grams, unit: 'g' }, CONF, SOURCE);
  }

  const image = asText(variant['featured_image']);
  if (image !== undefined) {
    const resolved = resolveUrl(image, context.pageUrl);
    if (resolved !== undefined) setField(draft, 'images', [resolved], CONF, SOURCE);
  }
}

export const shopifyAdapter: PlatformAdapter = {
  name: 'Shopify collection JSON',
  platform: 'shopify',

  detect(page: PageContext, $: CheerioAPI): PlatformDetection | undefined {
    return detectPlatforms(page, $).find((detection) => detection.platform === 'shopify');
  },

  async fetchCategory(context: AdapterContext): Promise<AdapterReading> {
    const issues: ExtractionIssue[] = [];
    const unavailable = (): AdapterReading => ({
      products: [],
      issues,
      incomplete: true,
      requests: 0,
    });

    const handle = context.options.categoryFilter ?? collectionHandleFromUrl(context.page.url);
    const path = handle === undefined ? '/products.json' : `/collections/${handle}/products.json`;
    const endpoint = resolveUrl(path, context.page.url);
    if (endpoint === undefined) return unavailable();

    const limit = Math.min(MAX_LIMIT, Math.max(1, context.options.perPage ?? MAX_LIMIT));
    const maxPages = Math.max(1, context.options.maxPages ?? DEFAULT_MAX_PAGES);

    const mapContext: MapContext = {
      pageUrl: context.page.url,
      currency: shopCurrency(context.page, context.options.defaultCurrency),
      issues,
    };

    const drafts: ProductDraft[] = [];
    const seen = new Set<string>();
    let incomplete = false;
    let fetched = 0;

    for (let page = 1; page <= maxPages; page++) {
      const response = await context.http({
        url: buildUrl(endpoint, { limit, page }),
        headers: { accept: 'application/json' },
      });

      if (response.status < 200 || response.status >= 300) {
        if (page === 1) return unavailable();
        incomplete = true;
        break;
      }

      const body = parseJsonResponse(response);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        // The merchant switched the endpoint off and the storefront answered
        // with its own HTML. Not an error, just not available here.
        if (page === 1) return unavailable();
        incomplete = true;
        break;
      }

      const products = asObjects((body as JsonObject)['products']);
      fetched += products.length;

      for (const product of products) {
        const draft = mapShopifyProduct(product, mapContext);
        // Pagination on this endpoint is not guaranteed, and a repeated page is
        // exactly how it fails. Deduplicate rather than double the catalogue.
        if (draft === undefined || seen.has(draft.sourceUrl)) continue;
        seen.add(draft.sourceUrl);
        drafts.push(draft);
      }

      // A short page is the only reliable end-of-collection signal here.
      if (products.length < limit) break;
      if (page === maxPages) incomplete = true;
    }

    if (drafts.length === 0) return unavailable();

    // ROADMAP §6.14: cross-check against what the collection says it holds.
    const declared = declaredProductCount(context.$);
    if (declared !== undefined && fetched < declared) {
      incomplete = true;
      issues.push({
        severity: 'warning',
        kind: 'structure-changed',
        code: 'shopify-count-mismatch',
        source: SOURCE,
        url: context.page.url,
        message:
          `The collection says it holds ${String(declared)} products but ` +
          `/products.json returned ${String(fetched)}. That endpoint is unofficial and ` +
          `can be capped or partly disabled, so the scan falls back to reading the page.`,
      });
    }

    const scannedAt = context.options.scannedAt ?? new Date().toISOString();
    const products: CanonicalProduct[] = drafts.flatMap((draft) =>
      flattenDraft(draft, { layer: 'A', scannedAt })
    );

    return { products, issues, incomplete, requests: 0 };
  },
};
