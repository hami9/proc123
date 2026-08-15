/**
 * Types shared by every extraction layer.
 *
 * The pipeline's job is not only to produce values but to be able to explain
 * them afterwards: which layer and which markup produced each field, how much
 * it should be trusted, and why a field came out empty. See CLAUDE.md §11.
 */

import type { CanonicalProduct, ExtractionLayer } from '../model.js';
import type { ProductDraft } from './draft.js';

/** A page as handed to the pipeline. The extension supplies rendered HTML. */
export interface PageContext {
  /** Absolute URL the HTML came from. Relative links resolve against it. */
  url: string;
  html: string;
  /** BCP 47 tag from `<html lang>` or a response header, when known. */
  locale?: string;
}

/** The specific markup a value was read out of, within a layer. */
export type ExtractionSource =
  'json-ld' | 'microdata' | 'opengraph' | 'dom' | 'platform-api' | 'ai';

/** CLAUDE.md §11 error taxonomy. Only failures are classified. */
export type ExtractionErrorKind =
  'network' | 'structure-changed' | 'site-blocked' | 'parse-failed' | 'ai-failed';

export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * One line of the "why is this field empty?" report.
 *
 * `info` entries are not problems — they record a decision the pipeline made
 * that the user might disagree with, such as reading a price out of a range.
 */
export interface ExtractionIssue {
  severity: IssueSeverity;
  /** Stable machine-readable code, safe to switch on. */
  code: string;
  /** Written for a user who does not know the internals. */
  message: string;
  /** Set on `error` only — the taxonomy classifies failures, not decisions. */
  kind?: ExtractionErrorKind;
  source?: ExtractionSource;
  field?: ExtractedField;
  /** The product or page the issue is about. */
  url?: string;
}

/**
 * The fields extraction actually produces.
 *
 * `sourceUrl` and `extractionMeta` are excluded because the pipeline sets them
 * rather than reading them off the page.
 */
export type ExtractedField =
  | 'kind'
  | 'sku'
  | 'parentSku'
  | 'name'
  | 'shortDescription'
  | 'description'
  | 'regularPrice'
  | 'salePrice'
  | 'inStock'
  | 'stockQuantity'
  | 'categoryPath'
  | 'images'
  | 'attributes'
  | 'tags'
  | 'weight'
  | 'dimensions'
  | 'brand'
  | 'gtin';

/**
 * Derived from `CanonicalProduct` on purpose: the two can never drift apart,
 * because naming a field here that the model does not have fails to compile.
 */
export type ExtractedFields = {
  [K in ExtractedField]-?: NonNullable<CanonicalProduct[K]>;
};

/**
 * How much a value is trusted, per source. Used to resolve conflicts when two
 * kinds of markup on the same page disagree.
 *
 * The ordering is the point, not the exact numbers: an explicit schema.org
 * property beats microdata beats an OpenGraph meta tag beats a guess. `1.0` is
 * reserved for Layer A, where the store's own API answered.
 */
export const CONFIDENCE = {
  /** A property stated directly on a schema.org Product node. */
  jsonLd: 0.95,
  /** Read from schema.org markup, but inferred rather than stated. */
  jsonLdDerived: 0.8,
  microdata: 0.7,
  /** Inferred from microdata, e.g. a breadcrumb trail. */
  microdataDerived: 0.6,
  opengraph: 0.5,
  /** Stated, but known to be approximate — a price range, say. */
  weak: 0.35,
} as const;

export interface ExtractionOptions {
  /** ISO 8601 timestamp written into `extractionMeta`. Defaults to now. */
  scannedAt?: string;
  /**
   * Applied to prices when the page states `IRR` without saying toman or rial.
   * Leave unset so the unit stays unknown and the exporter can ask the user —
   * a wrong guess here is a silent 10x error. See CLAUDE.md §7.8.
   */
  defaultCurrencyUnit?: 'toman' | 'rial';
  /** Used when the markup gives a price with no currency at all. */
  defaultCurrency?: string;
}

/**
 * What one kind of markup yielded, before the layer merges the sources.
 *
 * Kept separate from `ExtractionResult` because a source produces drafts, not
 * products: only the merged view knows whether a name was ever found.
 */
export interface SourceReading {
  source: ExtractionSource;
  drafts: ProductDraft[];
  /** Product URLs seen but not described. */
  discoveredUrls: string[];
  /** The page's category trail, if this markup published one. */
  breadcrumb: string[];
  issues: ExtractionIssue[];
}

/** What a layer returns: products, URLs worth visiting next, and an audit trail. */
export interface ExtractionResult {
  layer: ExtractionLayer;
  products: CanonicalProduct[];
  /**
   * Product page URLs the page pointed at but did not describe fully — an
   * `ItemList` of links, for example. Phase 4 traversal picks these up.
   */
  discoveredUrls: string[];
  issues: ExtractionIssue[];
}
