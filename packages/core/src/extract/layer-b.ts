/**
 * Layer B — structured markup.
 *
 * JSON-LD, then Microdata, then OpenGraph. Every source that has something to
 * say about a product says it; the merge keeps the most trustworthy answer for
 * each field and the rest stays on the record as confidence and issues.
 *
 * This layer is platform-independent by construction, which is why CLAUDE.md
 * §14 puts it before any platform adapter: it is the widest coverage per unit
 * of work in the project.
 */

import type { CanonicalProduct } from '../model.js';
import { type ProductDraft, flattenDraft, getField, mergeDraftInto, setField } from './draft.js';
import { loadHtml } from './html.js';
import { extractJsonLd } from './jsonld.js';
import { extractMicrodata } from './microdata.js';
import { extractOpenGraph } from './opengraph.js';
import { trimSelfCrumb } from './schema-product.js';
import { readVariationForm } from './variations.js';
import {
  CONFIDENCE,
  type ExtractionIssue,
  type ExtractionOptions,
  type ExtractionResult,
  type ExtractionSource,
  type PageContext,
  type SourceReading,
} from './types.js';

/**
 * Fold every source's drafts into one set, keyed by product URL.
 *
 * The single-product special case matters in practice: one source's canonical
 * URL carries a `?variant=` or a trailing slash the other's does not, and
 * without it a product page exports two half-filled rows instead of one whole
 * one. It only applies when both sides describe exactly one product, so a
 * category page is never affected.
 */
function mergeReadings(readings: readonly SourceReading[]): ProductDraft[] {
  const merged: ProductDraft[] = [];
  const byUrl = new Map<string, ProductDraft>();

  for (const reading of readings) {
    for (const draft of reading.drafts) {
      const existing = byUrl.get(draft.sourceUrl);
      if (existing !== undefined) {
        mergeDraftInto(existing, draft);
        continue;
      }

      const only = merged.length === 1 ? merged[0] : undefined;
      if (only !== undefined && reading.drafts.length === 1) {
        mergeDraftInto(only, draft);
        continue;
      }

      byUrl.set(draft.sourceUrl, draft);
      merged.push(draft);
    }
  }

  return merged;
}

interface Breadcrumb {
  path: string[];
  source: ExtractionSource;
  confidence: number;
}

function bestBreadcrumb(readings: readonly SourceReading[]): Breadcrumb | undefined {
  for (const reading of readings) {
    if (reading.breadcrumb.length === 0) continue;
    return {
      path: reading.breadcrumb,
      source: reading.source,
      confidence:
        reading.source === 'json-ld' ? CONFIDENCE.jsonLdDerived : CONFIDENCE.microdataDerived,
    };
  }
  return undefined;
}

/**
 * Run Layer B over one page.
 *
 * SKUs are deliberately not generated here. `assignSkus` needs to see a whole
 * scan at once to guarantee uniqueness across pages, so it belongs to the
 * export step, not to a single page's extraction (CLAUDE.md §7.3).
 */
export function extractStructured(
  page: PageContext,
  options: ExtractionOptions = {}
): ExtractionResult {
  const $ = loadHtml(page.html);

  // Priority order. JSON-LD is the most explicit, OpenGraph the least.
  //
  // The variation form sits second, and the placement is deliberate. It carries
  // the shop's own per-variation prices, SKUs and stock — better data than
  // anything below it — but `mergeDraftInto` refuses to reconcile two sources'
  // variant lists, so whichever source is reached first owns them outright.
  // Leaving JSON-LD ahead of it means a page that already published a
  // `ProductGroup` keeps behaving exactly as it did, and the form fills the far
  // more common case where JSON-LD described the parent and said nothing about
  // its variations.
  const readings: SourceReading[] = [
    extractJsonLd($, page, options),
    readVariationForm(page, options, $),
    extractMicrodata($, page, options),
    extractOpenGraph($, page, options),
  ];

  const issues: ExtractionIssue[] = readings.flatMap((reading) => reading.issues);
  const drafts = mergeReadings(readings);

  const breadcrumb = bestBreadcrumb(readings);
  if (breadcrumb !== undefined) {
    for (const draft of drafts) {
      const name = getField(draft, 'name');
      const path = name === undefined ? breadcrumb.path : trimSelfCrumb(breadcrumb.path, name);
      setField(draft, 'categoryPath', path, breadcrumb.confidence, breadcrumb.source);
    }
  }

  const scannedAt = options.scannedAt ?? new Date().toISOString();
  const products: CanonicalProduct[] = [];

  for (const draft of drafts) {
    const rows = flattenDraft(draft, { layer: 'B', scannedAt });
    if (rows.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'product-name-missing',
        field: 'name',
        url: draft.sourceUrl,
        message:
          'Markup on the page described a product but never named it, so the row was ' +
          'skipped rather than exported blank.',
      });
      continue;
    }
    products.push(...rows);
  }

  const produced = new Set(products.map((product) => product.sourceUrl));
  const discoveredUrls = [...new Set(readings.flatMap((reading) => reading.discoveredUrls))].filter(
    (url) => !produced.has(url)
  );

  if (products.length === 0 && discoveredUrls.length === 0) {
    issues.push({
      severity: 'info',
      code: 'no-structured-data',
      message:
        'This page publishes no product markup Layer B can read — no JSON-LD, no ' +
        'Microdata, no product meta tags. Teach proc123 the site with Selector ' +
        'Learning Mode to scan it.',
    });
  }

  return { layer: 'B', products, discoveredUrls, issues };
}
