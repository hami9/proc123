/**
 * "Why is this field empty?" (CLAUDE.md §11).
 *
 * The brief asks for a report "the user can read without knowing the
 * internals", and that phrase rules out most of what a developer would write.
 * No layer letters, no selector strings, no confidence decimals in the prose. A
 * person looking at a blank Description column wants one of four answers:
 *
 *   1. You switched it off.          → they can switch it back on
 *   2. The shop never published it.  → nothing to be done, and that is fine
 *   3. This one is never available.  → Tier 3; stop looking
 *   4. Something went wrong.         → and here is the specific thing
 *
 * The fourth is the only one that is a bug report, and separating it from the
 * other three is the whole value of the report. Without it, every empty column
 * looks like a defect, and the three-quarters that are normal drown the one
 * that is not.
 */

import type { CanonicalProduct } from '../model.js';
import type { ExtractionIssue, ExtractionErrorKind } from '../extract/types.js';
import {
  ALL_TARGET_FIELDS,
  FIELD_PROPERTIES,
  type Proc123Config,
  type TargetField,
} from '../config/types.js';

/** CLAUDE.md §6. Tier 3 has no `TargetField` — it is not offerable. */
export type FieldTier = 1 | 2;

export const FIELD_TIER: Readonly<Record<TargetField, FieldTier>> = {
  name: 1,
  regularPrice: 1,
  salePrice: 1,
  categories: 1,
  images: 1,
  attributes: 1,
  stock: 1,
  description: 1,
  shortDescription: 1,
  sku: 2,
  tags: 2,
  weight: 2,
  dimensions: 2,
  brand: 2,
  gtin: 2,
};

/**
 * The part of `ProfileHealth` this module needs.
 *
 * Structural rather than an import from `learn/`, so the report does not drag
 * the whole selector-learning module in behind it.
 */
export interface ProfileHealthSummary {
  healthy: boolean;
  summary: string;
  brokenFields: readonly string[];
}

/** Why a field came out empty. Ordered from "expected" to "wrong". */
export type EmptyReason =
  /** The config does not ask for it. */
  | 'turned-off'
  /** Asked for, and no source on the page published it. */
  | 'not-published'
  /** Asked for, but the scan failed before it could look. */
  | 'scan-failed'
  /** Present on some products and missing on others. */
  | 'partial';

export interface FieldExplanation {
  field: TargetField;
  tier: FieldTier;
  /** How many products carry a value. */
  filled: number;
  total: number;
  reason: EmptyReason | 'filled';
  /** Which layers produced it, best first. Empty when nothing did. */
  sources: string[];
  /** Written for someone who has never read this codebase. */
  message: string;
}

export interface Report {
  scannedUrl: string;
  productCount: number;
  fields: FieldExplanation[];
  /** The failures worth acting on, deduplicated. */
  problems: ExtractionIssue[];
  /** One paragraph a user can read first and often stop at. */
  summary: string;
  /** Tier 3 columns, named once so nobody goes looking. */
  neverAvailable: string;
  /**
   * Set when a taught profile was used and has started to rot (§11).
   *
   * Worth its own field rather than another issue: a stale profile is the one
   * failure the user can actually fix themselves, by teaching the site again.
   */
  profileHealth?: string;
}

const LAYER_NAMES: Record<string, string> = {
  A: 'the shop’s own product API',
  B: 'the page’s structured data',
  C: 'the layout you taught it',
  D: 'the AI fallback',
};

/**
 * Confidence, in words.
 *
 * The numbers are meaningful to the pipeline and meaningless to a user; what
 * they actually want to know is whether to double-check the value.
 */
export function describeConfidence(confidence: number): string {
  if (confidence >= 0.95) return 'certain';
  if (confidence >= 0.7) return 'reliable';
  if (confidence >= 0.5) return 'probable';
  if (confidence >= 0.35) return 'rough';
  return 'worth checking';
}

function hasValue(product: CanonicalProduct, field: TargetField): boolean {
  return FIELD_PROPERTIES[field].some((property) => {
    const value = (product as unknown as Record<string, unknown>)[property];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

/** Which layers contributed a field, most confident first. */
function sourcesFor(products: readonly CanonicalProduct[], field: TargetField): string[] {
  const best = new Map<string, number>();
  for (const product of products) {
    if (!hasValue(product, field)) continue;
    const confidence = Math.max(
      ...FIELD_PROPERTIES[field].map(
        (property) => product.extractionMeta.fieldConfidence[property] ?? 0
      )
    );
    const layer = product.extractionMeta.layer;
    best.set(layer, Math.max(best.get(layer) ?? 0, confidence));
  }

  return [...best.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([layer, confidence]) => {
      const name = LAYER_NAMES[layer] ?? `layer ${layer}`;
      return `${name} (${describeConfidence(confidence)})`;
    });
}

/**
 * Failure kinds that mean "the scan could not look", as opposed to "the scan
 * looked and the page did not say".
 *
 * The distinction is the report's whole job: a blocked site and an unpriced
 * product both produce a blank cell, and only one of them is a problem.
 */
const BLOCKING_KINDS: ReadonlySet<ExtractionErrorKind> = new Set([
  'network',
  'site-blocked',
  'parse-failed',
  'structure-changed',
]);

function scanFailed(issues: readonly ExtractionIssue[]): ExtractionIssue | undefined {
  return issues.find(
    (issue) =>
      issue.severity === 'error' && issue.kind !== undefined && BLOCKING_KINDS.has(issue.kind)
  );
}

function explainField(
  field: TargetField,
  products: readonly CanonicalProduct[],
  wanted: ReadonlySet<TargetField>,
  blocking: ExtractionIssue | undefined
): FieldExplanation {
  const tier = FIELD_TIER[field];
  const total = products.length;
  const filled = products.filter((product) => hasValue(product, field)).length;
  const sources = sourcesFor(products, field);

  if (!wanted.has(field)) {
    return {
      field,
      tier,
      filled,
      total,
      reason: 'turned-off',
      sources: [],
      message: `Empty because "${field}" is switched off in your settings. Turn it on and scan again to fill it.`,
    };
  }

  if (filled === total && total > 0) {
    return {
      field,
      tier,
      filled,
      total,
      reason: 'filled',
      sources,
      message: `Filled for every product, from ${sources.join(' and ')}.`,
    };
  }

  if (filled === 0) {
    if (blocking !== undefined) {
      return {
        field,
        tier,
        filled,
        total,
        reason: 'scan-failed',
        sources: [],
        message: `Empty because the scan could not finish: ${blocking.message}`,
      };
    }
    return {
      field,
      tier,
      filled,
      total,
      reason: 'not-published',
      sources: [],
      message:
        tier === 1
          ? `Empty because this shop’s pages do not publish it anywhere proc123 can read. ` +
            `If you can see it on the page yourself, "Teach proc123 this site" will pick it up.`
          : `Empty because the shop does not publish it. This is common and usually fine — ` +
            `most shops never fill this in.`,
    };
  }

  return {
    field,
    tier,
    filled,
    total,
    reason: 'partial',
    sources,
    message:
      `Filled for ${String(filled)} of ${String(total)} products, from ${sources.join(' and ')}. ` +
      `The rest of the pages simply do not state it.`,
  };
}

/**
 * Collapse issues down to the ones worth showing.
 *
 * A 40-page crawl produces the same warning 40 times; repeating it is how a
 * report becomes something nobody reads. Identical codes are merged and counted.
 */
export function summarizeIssues(issues: readonly ExtractionIssue[]): ExtractionIssue[] {
  const byCode = new Map<string, { issue: ExtractionIssue; count: number }>();
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    const seen = byCode.get(issue.code);
    if (seen === undefined) byCode.set(issue.code, { issue, count: 1 });
    else seen.count += 1;
  }

  const rank = { error: 0, warning: 1, info: 2 } as const;
  return [...byCode.values()]
    .sort((a, b) => rank[a.issue.severity] - rank[b.issue.severity])
    .map(({ issue, count }) =>
      count === 1 ? issue : { ...issue, message: `${issue.message} (${String(count)} times)` }
    );
}

/**
 * Build the report.
 *
 * Takes what a finished scan already has — products, issues, config — rather
 * than re-deriving anything, so the report can never disagree with the export
 * it is explaining.
 */
export function explainScan(input: {
  url: string;
  products: readonly CanonicalProduct[];
  issues: readonly ExtractionIssue[];
  config: Proc123Config;
  /** From `checkProfileHealth`, when a taught profile was in play. */
  profileHealth?: ProfileHealthSummary;
}): Report {
  const wanted = new Set(input.config.targetFields);
  const blocking = scanFailed(input.issues);
  const fields = ALL_TARGET_FIELDS.map((field) =>
    explainField(field, input.products, wanted, blocking)
  );

  const problems = summarizeIssues(input.issues);
  const asked = fields.filter((entry) => entry.reason !== 'turned-off');
  const complete = asked.filter((entry) => entry.reason === 'filled').length;
  const emptyTier1 = asked.filter((entry) => entry.tier === 1 && entry.reason === 'not-published');

  const summary =
    input.products.length === 0
      ? blocking === undefined
        ? 'No products were found on this page. If you can see products yourself, ' +
          'try "Teach proc123 this site" so it learns the layout.'
        : `The scan stopped: ${blocking.message}`
      : `${String(input.products.length)} product(s) read. ` +
        `${String(complete)} of ${String(asked.length)} requested fields are filled for every one of them. ` +
        (emptyTier1.length === 0
          ? 'Nothing here looks wrong.'
          : `${emptyTier1.map((entry) => entry.field).join(', ')} came back empty everywhere, ` +
            `which usually means this shop does not publish them in a readable form.`);

  const health = input.profileHealth;
  return {
    scannedUrl: input.url,
    productCount: input.products.length,
    fields,
    problems,
    summary,
    ...(health === undefined || health.healthy
      ? {}
      : {
          profileHealth:
            `The layout you taught proc123 for this site has stopped matching: ${health.summary} ` +
            `Use "Teach proc123 this site" again to point it at the right places.`,
        }),
    // §6 Tier 3: these live only in the source shop's database and are never
    // rendered in any page, so no amount of scanning will ever produce them.
    neverAvailable:
      'Columns like woodmart_*, rank_math_* and _elementor_* are stored inside the ' +
      'original shop’s database and never appear on a page. proc123 leaves them empty ' +
      'rather than inventing values.',
  };
}

/** The report as plain text, for a file the user can send to somebody. */
export function formatReport(report: Report): string {
  const lines = [`proc123 — why is this field empty?`, report.scannedUrl, '', report.summary, ''];

  const shown = report.fields.filter((field) => field.reason !== 'filled');
  if (shown.length === 0) {
    lines.push('Every field you asked for was filled.');
  } else {
    lines.push('Fields:');
    for (const field of shown) lines.push(`  ${field.field}: ${field.message}`);
  }

  if (report.profileHealth !== undefined) {
    lines.push('', report.profileHealth);
  }

  if (report.problems.length > 0) {
    lines.push('', 'Problems:');
    for (const problem of report.problems) {
      lines.push(`  [${problem.severity}] ${problem.message}`);
    }
  }

  lines.push('', report.neverAvailable, '');
  return lines.join('\n');
}
