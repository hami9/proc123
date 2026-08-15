/**
 * Embedded state — `__NEXT_DATA__`, `__NUXT__`, Apollo caches.
 *
 * A headless storefront renders from a JSON blob it ships in the page, and that
 * blob frequently holds complete product objects. Reading it is Layer A without
 * a request: no traffic, nothing to rate-limit, nothing to block.
 *
 * The catch is that the shape is the application's own, not a standard. So this
 * module is conservative in a way the other adapters are not:
 *
 * - A payload with Shopify's shape is mapped by Shopify's own mapper, at full
 *   confidence. That covers most headless storefronts, because most of them are
 *   Shopify behind Next.js.
 * - Anything else is matched against the Storefront-GraphQL-ish shape that
 *   headless builds converge on, at reduced confidence, and only when the
 *   object carries a name *and* a price *and* an identity. Two out of three is
 *   a category tile or a search suggestion, not a product.
 * - Nothing else is guessed at. Inventing products out of arbitrary JSON is
 *   Layer C and D's job, with a user in the loop.
 */

import type { CanonicalProduct, Money } from '../model.js';
import { parseNumberValue } from '../numbers.js';
import { canonicalizeUrl, resolveUrl } from '../url.js';
import {
  type ProductDraft,
  createDraft,
  flattenDraft,
  setField,
  setPricePair,
} from '../extract/draft.js';
import {
  type JsonObject,
  type JsonValue,
  asArray,
  asObjects,
  asText,
  isJsonObject,
  parseJsonLenient,
} from '../extract/json.js';
import type { CheerioAPI } from '../extract/html.js';
import { CONFIDENCE, type ExtractionIssue, type PageContext } from '../extract/types.js';
import { detectPlatforms } from './detect.js';
import { type MapContext, mapShopifyProduct, shopCurrency } from './shopify.js';
import type {
  AdapterContext,
  AdapterReading,
  PlatformAdapter,
  PlatformDetection,
} from './types.js';

const SOURCE = 'platform-api';
/**
 * A shape recognised rather than one we were told about, so this sits below
 * JSON-LD: if the page also publishes markup, believe the markup. Shopify-shaped
 * payloads go through `mapShopifyProduct`, which uses full API confidence.
 */
const INFERRED = CONFIDENCE.jsonLdDerived;

/** Guard against a pathologically deep state blob. */
const MAX_DEPTH = 14;
/** Guard against walking a megabyte of cache entries. */
const MAX_NODES = 20_000;

export interface EmbeddedState {
  /** Where it came from, for the report. */
  label: string;
  value: JsonValue;
}

/**
 * Pull every JSON state blob out of the page.
 *
 * Script-tag payloads are parsed as JSON. Assignment forms
 * (`window.__NUXT__ = {...}`) are read by balancing braces from the `=`, which
 * handles the object-literal case; Nuxt 2's IIFE form is not JSON and is left
 * alone rather than half-parsed.
 */
export function collectEmbeddedState($: CheerioAPI, page: PageContext): EmbeddedState[] {
  const found: EmbeddedState[] = [];

  for (const id of ['__NEXT_DATA__', '__NUXT_DATA__', '__APOLLO_STATE__']) {
    const body = $(`script#${id}`).first().text();
    if (body.trim() === '') continue;
    const parsed = parseJsonLenient(body);
    if (parsed.value !== undefined) found.push({ label: id, value: parsed.value });
  }

  for (const global of [
    '__NUXT__',
    '__INITIAL_STATE__',
    '__APOLLO_STATE__',
    '__PRELOADED_STATE__',
  ]) {
    const value = readAssignedObject(page.html, global);
    if (value !== undefined) found.push({ label: `window.${global}`, value });
  }

  return found;
}

/** Read `window.NAME = { ... }` by balancing braces, ignoring strings. */
function readAssignedObject(html: string, name: string): JsonValue | undefined {
  const marker = new RegExp(`${name.replace(/\$/g, '\\$')}\\s*=\\s*\\{`).exec(html);
  if (marker === null) return undefined;

  const start = marker.index + marker[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i] ?? '';

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return parseJsonLenient(html.slice(start, i + 1)).value;
    }
  }

  return undefined;
}

/** Shopify's REST product shape: a `variants` array whose members have prices. */
function isShopifyShaped(node: JsonObject): boolean {
  if (typeof node['title'] !== 'string') return false;
  const variants = asObjects(node['variants']);
  return variants.length > 0 && variants.some((variant) => variant['price'] !== undefined);
}

/**
 * The shape headless storefronts converge on, mostly because it is Shopify's
 * Storefront GraphQL API with the envelope removed.
 */
function isGraphqlProductShaped(node: JsonObject): boolean {
  const named = typeof node['title'] === 'string' || typeof node['name'] === 'string';
  if (!named) return false;

  const identified =
    typeof node['handle'] === 'string' ||
    typeof node['slug'] === 'string' ||
    typeof node['id'] === 'string' ||
    typeof node['url'] === 'string';
  if (!identified) return false;

  return readGraphqlPrice(node, undefined) !== undefined;
}

/** `priceRange.minVariantPrice.amount`, `price.amount`, or a bare `price`. */
function readGraphqlPrice(node: JsonObject, currency: string | undefined): Money | undefined {
  const candidates: (JsonValue | undefined)[] = [
    isJsonObject(node['priceRange']) ? node['priceRange']['minVariantPrice'] : undefined,
    node['price'],
    node['priceV2'],
  ];

  for (const candidate of candidates) {
    if (isJsonObject(candidate)) {
      const amount = parseNumberValue(asText(candidate['amount']) ?? '', {
        ambiguousGrouping: 'decimal',
      });
      if (amount === undefined) continue;
      return { amount, currency: asText(candidate['currencyCode']) ?? currency ?? '' };
    }

    const text = asText(candidate);
    if (text === undefined) continue;
    const amount = parseNumberValue(text, { ambiguousGrouping: 'decimal' });
    if (amount !== undefined) return { amount, currency: currency ?? '' };
  }

  return undefined;
}

function mapGraphqlProduct(node: JsonObject, context: MapContext): ProductDraft | undefined {
  const name = asText(node['title']) ?? asText(node['name']);
  if (name === undefined) return undefined;

  const handle = asText(node['handle']) ?? asText(node['slug']);
  const explicit = asText(node['url']) ?? asText(node['onlineStoreUrl']);
  const target =
    explicit ?? (handle === undefined ? undefined : `/products/${handle}`) ?? context.pageUrl;
  const url = resolveUrl(target, context.pageUrl) ?? context.pageUrl;

  const draft = createDraft(canonicalizeUrl(url));
  setField(draft, 'name', name, INFERRED, SOURCE);
  setField(draft, 'kind', 'simple', INFERRED, SOURCE);
  setField(
    draft,
    'description',
    asText(node['descriptionHtml']) ?? asText(node['description']),
    INFERRED,
    SOURCE
  );
  setField(draft, 'sku', asText(node['sku']), INFERRED, SOURCE);
  setField(draft, 'brand', asText(node['vendor']) ?? asText(node['brand']), INFERRED, SOURCE);

  const available = node['availableForSale'] ?? node['available'] ?? node['inStock'];
  if (typeof available === 'boolean') setField(draft, 'inStock', available, INFERRED, SOURCE);

  const price = readGraphqlPrice(node, context.currency);
  const compareAt = isJsonObject(node['compareAtPriceRange'])
    ? readGraphqlPrice(
        { price: node['compareAtPriceRange']['minVariantPrice'] ?? null },
        context.currency
      )
    : readGraphqlPrice({ price: node['compareAtPrice'] ?? null }, context.currency);

  if (compareAt !== undefined && price !== undefined && compareAt.amount > price.amount) {
    setPricePair(draft, { regular: compareAt, sale: price }, INFERRED, SOURCE);
  } else {
    setPricePair(draft, { regular: price }, INFERRED, SOURCE);
  }

  setField(draft, 'images', readImages(node, context.pageUrl), INFERRED, SOURCE);
  return draft;
}

/** Images arrive as strings, as `{url|src}`, or wrapped in a GraphQL `edges` list. */
function readImages(node: JsonObject, pageUrl: string): string[] {
  const raw = node['images'] ?? node['featuredImage'] ?? node['image'];
  const entries = isJsonObject(raw)
    ? asArray(raw['edges']).length > 0
      ? asObjects(raw['edges']).map((edge) => edge['node'] ?? null)
      : [raw as JsonValue]
    : asArray(raw);

  const out: string[] = [];
  for (const entry of entries) {
    const src = isJsonObject(entry)
      ? (asText(entry['url']) ?? asText(entry['src']) ?? asText(entry['originalSrc']))
      : asText(entry);
    if (src === undefined) continue;
    const resolved = resolveUrl(src, pageUrl);
    if (resolved !== undefined && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** Walk a state blob, collecting the product-shaped objects in it. */
export function findProductNodes(state: JsonValue): {
  shopify: JsonObject[];
  graphql: JsonObject[];
} {
  const shopify: JsonObject[] = [];
  const graphql: JsonObject[] = [];
  const seen = new Set<JsonObject>();
  let visited = 0;

  const walk = (value: JsonValue, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    visited += 1;

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (!isJsonObject(value)) return;

    if (!seen.has(value)) {
      if (isShopifyShaped(value)) {
        seen.add(value);
        shopify.push(value);
        // Its variants are part of it, not products in their own right.
        return;
      }
      if (isGraphqlProductShaped(value)) {
        seen.add(value);
        graphql.push(value);
        return;
      }
    }

    for (const entry of Object.values(value)) walk(entry, depth + 1);
  };

  walk(state, 0);
  return { shopify, graphql };
}

export const embeddedStateAdapter: PlatformAdapter = {
  name: 'Embedded application state',
  platform: 'nextjs',

  detect(page: PageContext, $: CheerioAPI): PlatformDetection | undefined {
    const detections = detectPlatforms(page, $);
    return detections.find(
      (detection) => detection.platform === 'nextjs' || detection.platform === 'nuxt'
    );
  },

  fetchCategory(context: AdapterContext): Promise<AdapterReading> {
    const issues: ExtractionIssue[] = [];
    const mapContext: MapContext = {
      pageUrl: context.page.url,
      currency: shopCurrency(context.page, context.options.defaultCurrency),
      issues,
    };

    const drafts: ProductDraft[] = [];
    const byUrl = new Set<string>();

    for (const state of collectEmbeddedState(context.$, context.page)) {
      const { shopify, graphql } = findProductNodes(state.value);

      for (const node of shopify) {
        const draft = mapShopifyProduct(node, mapContext);
        if (draft === undefined || byUrl.has(draft.sourceUrl)) continue;
        byUrl.add(draft.sourceUrl);
        drafts.push(draft);
      }

      for (const node of graphql) {
        const draft = mapGraphqlProduct(node, mapContext);
        if (draft === undefined || byUrl.has(draft.sourceUrl)) continue;
        byUrl.add(draft.sourceUrl);
        drafts.push(draft);
      }
    }

    if (drafts.length === 0) {
      return Promise.resolve({ products: [], issues, incomplete: true, requests: 0 });
    }

    const scannedAt = context.options.scannedAt ?? new Date().toISOString();
    const products: CanonicalProduct[] = drafts.flatMap((draft) =>
      flattenDraft(draft, { layer: 'A', scannedAt })
    );

    // The blob holds whatever this page rendered. It is not a catalogue query,
    // so the next page's products are simply not in it.
    return Promise.resolve({ products, issues, incomplete: false, requests: 0 });
  },
};
