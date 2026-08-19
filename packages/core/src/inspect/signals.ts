/**
 * The signal engine, shared by storefront detection and the inspector.
 *
 * `platform/detect.ts` established this shape and it was already right: score
 * weighted markers, sum them, clamp, and keep **every** marker that fired so
 * §11's report can answer "why did it say that?". The inspector needs the same
 * machinery over a much wider ruleset, so it lives here rather than being
 * written twice and drifting.
 *
 * Nothing in here fetches. Every test reads a document the caller already has
 * (CLAUDE.md §16) — an inspector that made its own requests would break §10's
 * politeness accounting and could not run inside a popup.
 */

import { type CheerioAPI, isElement } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';

export interface DetectContext {
  $: CheerioAPI;
  /** The whole document, lowercased once, for cheap substring probes. */
  html: string;
  /**
   * The document as it was written. Version numbers and font family names are
   * case-carrying, so a rule that reports a value reads this rather than
   * `html`, which has been flattened for matching.
   */
  raw: string;
  url: string;
}

export interface Signal {
  label: string;
  /** Contribution to confidence. Summed, then clamped to 1. */
  weight: number;
  test: (context: DetectContext) => boolean;
}

export function makeContext(page: PageContext, $: CheerioAPI): DetectContext {
  return { $, html: page.html.toLowerCase(), raw: page.html, url: page.url };
}

export const includes =
  (needle: string) =>
  (context: DetectContext): boolean =>
    context.html.includes(needle);

/** True when any of the needles appears. For a marker with several spellings. */
export const includesAny =
  (...needles: readonly string[]) =>
  (context: DetectContext): boolean =>
    needles.some((needle) => context.html.includes(needle));

export const selector =
  (query: string) =>
  (context: DetectContext): boolean =>
    context.$(query).length > 0;

export const bodyClass =
  (name: string) =>
  (context: DetectContext): boolean => {
    const classes = context.$('body').attr('class');
    return classes !== undefined && classes.toLowerCase().split(/\s+/).includes(name);
  };

export const generator =
  (name: string) =>
  (context: DetectContext): boolean => {
    const content = context.$('meta[name="generator"]').attr('content');
    return content !== undefined && content.toLowerCase().includes(name);
  };

/**
 * True when any element carries an attribute whose name starts with `prefix`.
 *
 * Several frameworks are only visible as a scoping attribute they stamp onto
 * markup — Vue's `data-v-*`, Angular's `_nghost-*`. There is no selector for
 * "attribute name starts with", so this walks the elements once.
 */
export const attrPrefix =
  (prefix: string) =>
  (context: DetectContext): boolean =>
    context
      .$('*')
      .toArray()
      .some(
        (node) =>
          isElement(node) && Object.keys(node.attribs).some((name) => name.startsWith(prefix))
      );

/** Below this, the evidence is one weak coincidence and not worth acting on. */
export const MIN_CONFIDENCE = 0.3;

export interface SignalResult {
  /** 0..1, rounded to two places. */
  confidence: number;
  /** Every marker that fired, verbatim, in rule order. */
  signals: string[];
}

/**
 * Score one rule set against a document.
 *
 * `undefined` means "not enough evidence" rather than "confidence 0" — the two
 * are different answers and a caller that treats a weak coincidence as a
 * detection is exactly the failure §16 warns about.
 */
export function runSignals(
  signals: readonly Signal[],
  context: DetectContext,
  minConfidence = MIN_CONFIDENCE
): SignalResult | undefined {
  const fired = signals.filter((signal) => signal.test(context));
  if (fired.length === 0) return undefined;

  const total = fired.reduce((sum, signal) => sum + signal.weight, 0);
  const confidence = Math.min(1, total);
  if (confidence < minConfidence) return undefined;

  return {
    confidence: Math.round(confidence * 100) / 100,
    signals: fired.map((signal) => signal.label),
  };
}

/**
 * Pull a version out of the document, or `undefined`.
 *
 * Reads `raw`, because a version is a value being reported rather than a
 * pattern being matched. Returns the first capture group of the first match —
 * a rule with no version pattern simply does not call this.
 */
export function firstMatch(context: DetectContext, pattern: RegExp): string | undefined {
  const match = pattern.exec(context.raw);
  return match?.[1];
}
