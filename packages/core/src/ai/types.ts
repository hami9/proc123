/**
 * Layer D — the AI fallback.
 *
 * The contract is CLAUDE.md §4's, and its three constraints are the reason this
 * module exists as a layer rather than as a call site:
 *
 * - It **fires only when Tier-1 fields are still incomplete** after A/B/C. A
 *   layer that ran unconditionally would charge the user per page for fields
 *   the markup already gave for free.
 * - It sends a **trimmed DOM subtree, never the whole page**. See `fragment.ts`.
 * - The **user supplies their own key**, from extension settings. Nothing in
 *   this package ever holds a default key, and `resolveConfig` refuses one in
 *   `proc123.config.json` so a key cannot reach a file that gets committed.
 *
 * A fourth constraint is ours rather than the brief's: a model can return
 * anything, including a plausible price for a product whose page never stated
 * one. `verify.ts` checks every answer back against the fragment that was sent
 * before any of it is merged.
 */

import type { CanonicalProduct } from '../model.js';
import type { ExtractionIssue } from '../extract/types.js';

/**
 * Below `weak` (0.35) on purpose.
 *
 * Layer D is the only layer that can be confidently wrong: the others read a
 * value off the page or fail, while a model produces well-formed output either
 * way. Ranking it under every reading of actual markup means an AI answer is
 * used when nothing else was found and overridden the moment anything else is.
 */
export const AI_CONFIDENCE = 0.3;

/** What Layer D is allowed to ask for. CLAUDE.md §6 Tier 1, plus Tier 2. */
export interface AIExtractInput {
  /** A trimmed subtree, not the page. See `trimFragment`. */
  htmlFragment: string;
  /** User-facing field names, as the config spells them. */
  targetFields: string[];
  /** BCP 47, when the page declared one. Helps with numerals and units. */
  locale?: string;
  /** The page the fragment came from; providers may cite it for context. */
  sourceUrl?: string;
  signal?: AbortSignal;
}

/**
 * Tokens, per call, so a scan can report what it cost (CLAUDE.md §4).
 *
 * `requests` is counted separately from tokens because a provider that fails
 * before answering still costs a request, and a user comparing providers wants
 * to see that.
 */
export interface AIUsage {
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export function emptyUsage(provider: string, model: string): AIUsage {
  return { provider, model, requests: 0, inputTokens: 0, outputTokens: 0 };
}

export function addUsage(into: AIUsage, add: AIUsage): AIUsage {
  return {
    provider: into.provider,
    model: into.model,
    requests: into.requests + add.requests,
    inputTokens: into.inputTokens + add.inputTokens,
    outputTokens: into.outputTokens + add.outputTokens,
  };
}

/**
 * One provider's answer.
 *
 * `fields` is `Partial<CanonicalProduct>` per §4, but nothing here trusts it —
 * it is the model's claim, not a product. `usage` is reported even when the
 * call failed, since a failed call may still have been billed.
 */
export interface AIExtractResult {
  fields: Partial<CanonicalProduct>;
  usage: AIUsage;
  issues: ExtractionIssue[];
}

/**
 * CLAUDE.md §4's interface, widened only to carry usage and issues back.
 *
 * `extract` must not throw for an ordinary failure — a refused key, a rate
 * limit, a malformed answer. Those are reported as issues so one bad page does
 * not end a crawl that was otherwise working.
 */
export interface AIProvider {
  /**
   * `'gemini' | 'openai' | 'claude'` for the three built in, but any string:
   * §4's interface is explicitly open so a user can supply their own adapter.
   * Spelled as a plain `string` because a union with `string` in it collapses
   * to `string` anyway — see `KNOWN_PROVIDERS` for the names we ship.
   */
  name: string;
  model: string;
  extract(input: AIExtractInput): Promise<AIExtractResult>;
}
