/**
 * JSON-LD — the first and best source in Layer B.
 *
 * SEO obliges stores on every platform to publish `Product` markup, which is
 * why this one file covers a larger share of the web than every
 * platform-specific adapter put together (CLAUDE.md §4).
 */

import {
  CONFIDENCE,
  type ExtractionIssue,
  type ExtractionOptions,
  type PageContext,
  type SourceReading,
} from './types.js';
import type { CheerioAPI } from './html.js';
import { type JsonValue, parseJsonLenient } from './json.js';
import { type SchemaScanContext, scanSchemaNodes } from './schema-product.js';

const JSON_LD_TYPES = new Set(['application/ld+json', 'application/json+ld']);

/**
 * Read every JSON-LD block on the page.
 *
 * One malformed block must not lose the others: stores template these with
 * string concatenation, and a page routinely carries four of them from four
 * different plugins.
 */
export function collectJsonLd($: CheerioAPI, issues: ExtractionIssue[]): JsonValue[] {
  const nodes: JsonValue[] = [];

  $('script[type]').each((_, element) => {
    const type = $(element).attr('type')?.trim().toLowerCase();
    if (type === undefined || !JSON_LD_TYPES.has(type)) return;

    const body = $(element).text();
    // An empty block is a plugin that had nothing to say, not a broken page.
    if (body.trim() === '') return;

    const result = parseJsonLenient(body);

    if (result.error !== undefined) {
      issues.push({
        severity: 'error',
        kind: 'parse-failed',
        code: 'json-ld-invalid',
        source: 'json-ld',
        message: `A JSON-LD block on the page is not valid JSON and was skipped: ${result.error}`,
      });
      return;
    }

    if (result.repaired === true) {
      issues.push({
        severity: 'info',
        code: 'json-ld-repaired',
        source: 'json-ld',
        message:
          'A JSON-LD block had a trailing comma. It was repaired and read; the ' +
          'store should be told, since search engines will have rejected it.',
      });
    }

    if (result.value !== undefined) nodes.push(result.value);
  });

  return nodes;
}

export function extractJsonLd(
  $: CheerioAPI,
  page: PageContext,
  options: ExtractionOptions = {}
): SourceReading {
  const issues: ExtractionIssue[] = [];
  const nodes = collectJsonLd($, issues);

  const base: SchemaScanContext = {
    pageUrl: page.url,
    source: 'json-ld',
    confidence: CONFIDENCE.jsonLd,
    derivedConfidence: CONFIDENCE.jsonLdDerived,
    weakConfidence: CONFIDENCE.weak,
    issues,
    ...(options.defaultCurrency !== undefined ? { defaultCurrency: options.defaultCurrency } : {}),
    ...(options.defaultCurrencyUnit !== undefined
      ? { defaultUnit: options.defaultCurrencyUnit }
      : {}),
  };

  const scan = scanSchemaNodes(nodes, base);

  return {
    source: 'json-ld',
    drafts: scan.drafts,
    discoveredUrls: scan.discoveredUrls,
    breadcrumb: scan.breadcrumb,
    issues,
  };
}
