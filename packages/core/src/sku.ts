/**
 * Deterministic SKU generation and linking.
 *
 * WooCommerce's importer always assigns its own product IDs, so the only thing
 * that can link a variation row to its parent row is the SKU (CLAUDE.md §7.2).
 * Scraped products rarely have one, so we generate them — deterministically, so
 * that re-scanning the same catalogue produces the same SKUs and a re-import
 * updates rather than duplicates (§7.3).
 */

import { type CanonicalProduct } from './model.js';
import { shortHash } from './sha256.js';
import { slugify } from './text.js';
import { canonicalizeUrl } from './url.js';

export const DEFAULT_SKU_PREFIX = 'P123';

/** Beyond this, a variation suffix is truncated and hash-stamped to stay readable. */
const MAX_VARIATION_SUFFIX = 40;

export interface SkuOptions {
  /** Prefix for generated parent SKUs. Default `P123`. */
  prefix?: string;
  /** Force generated SKUs to plain ASCII. Off by default — see `slugify`. */
  ascii?: boolean;
}

/** `P123-{shortHash(canonical sourceUrl)}` */
export function generateParentSku(sourceUrl: string, options: SkuOptions = {}): string {
  const prefix = options.prefix ?? DEFAULT_SKU_PREFIX;
  return `${prefix}-${shortHash(canonicalizeUrl(sourceUrl))}`;
}

/** `{parentSku}-{slug(attribute values)}` */
export function generateVariationSku(
  parentSku: string,
  attributeValues: readonly string[],
  options: SkuOptions = {}
): string {
  const joined = attributeValues.join(' ').trim();
  const hash = (input: string): string => shortHash(input, 6);

  let suffix =
    joined === ''
      ? hash(parentSku)
      : slugify(joined, options.ascii === true ? { ascii: true, hash } : {});

  if (suffix === '') suffix = hash(joined);

  if (suffix.length > MAX_VARIATION_SUFFIX) {
    // Keep it readable but still unique: truncating alone could collide.
    suffix = `${suffix.slice(0, MAX_VARIATION_SUFFIX - 7)}-${hash(joined)}`;
  }

  return `${parentSku}-${suffix}`;
}

export interface AssignSkusOptions extends SkuOptions {
  /**
   * Called whenever a duplicate SKU is disambiguated with a numeric suffix.
   * Every row needs a unique SKU (§7.3), and silently renaming one is the kind
   * of thing a user needs to know about.
   */
  onDuplicate?: (info: { sku: string; replacement: string; sourceUrl: string }) => void;
}

export interface SkuAssignment {
  products: CanonicalProduct[];
  /** How many SKUs were generated rather than taken from the source. */
  generated: number;
  /** How many collided and had to be disambiguated. */
  deduplicated: number;
}

/**
 * Fill in every missing SKU and parent link, and guarantee uniqueness.
 *
 * Parents are keyed by canonical `sourceUrl`, which is also how a variation
 * without an explicit `parentSku` finds its parent: variations of one product
 * live on one page. Input order is preserved; nothing is dropped.
 */
export function assignSkus(
  products: readonly CanonicalProduct[],
  options: AssignSkusOptions = {}
): SkuAssignment {
  const skuByCanonicalUrl = new Map<string, string>();
  const taken = new Set<string>();
  let generated = 0;
  let deduplicated = 0;

  const claim = (candidate: string, sourceUrl: string): string => {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    let attempt = 2;
    let replacement = `${candidate}-${attempt}`;
    while (taken.has(replacement)) {
      attempt += 1;
      replacement = `${candidate}-${attempt}`;
    }
    taken.add(replacement);
    deduplicated += 1;
    options.onDuplicate?.({ sku: candidate, replacement, sourceUrl });
    return replacement;
  };

  // Parents first: a variation cannot be keyed until its parent has a SKU.
  const withParentSkus = products.map((product) => {
    if (product.kind === 'variation') return product;

    const canonical = canonicalizeUrl(product.sourceUrl);
    if (product.sku === undefined || product.sku.trim() === '') {
      generated += 1;
    }
    const base =
      product.sku !== undefined && product.sku.trim() !== ''
        ? product.sku.trim()
        : generateParentSku(product.sourceUrl, options);

    const sku = claim(base, product.sourceUrl);
    skuByCanonicalUrl.set(canonical, sku);
    return { ...product, sku };
  });

  const result = withParentSkus.map((product) => {
    if (product.kind !== 'variation') return product;

    const parentSku =
      product.parentSku !== undefined && product.parentSku.trim() !== ''
        ? product.parentSku.trim()
        : skuByCanonicalUrl.get(canonicalizeUrl(product.sourceUrl));

    const attributeValues = product.attributes.flatMap((attribute) => attribute.values);

    if (product.sku === undefined || product.sku.trim() === '') {
      generated += 1;
    }
    const base =
      product.sku !== undefined && product.sku.trim() !== ''
        ? product.sku.trim()
        : generateVariationSku(
            parentSku ?? generateParentSku(product.sourceUrl, options),
            attributeValues,
            options
          );

    const sku = claim(base, product.sourceUrl);
    return parentSku === undefined ? { ...product, sku } : { ...product, sku, parentSku };
  });

  return { products: result, generated, deduplicated };
}
