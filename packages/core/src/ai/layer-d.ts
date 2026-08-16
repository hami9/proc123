/**
 * Layer D, assembled.
 *
 * The order of operations is the whole design, and each step exists to stop the
 * next one from doing damage:
 *
 *   gate → trim → ask → verify → fill only what was empty
 *
 * `needsAI` keeps the layer from running at all on a page the markup already
 * described. `trimFragment` bounds what leaves the machine and gives `verify`
 * something exact to check against. `verifyAnswer` drops anything the model did
 * not actually read. And the merge only ever fills fields that were empty — it
 * cannot overwrite a value that Layer A read from the store's own API, which is
 * what `AI_CONFIDENCE` sitting below every other confidence already implies but
 * this makes structural rather than arithmetic.
 */

import type { CanonicalProduct } from '../model.js';
import type { ExtractionIssue } from '../extract/types.js';
import type { PageContext } from '../extract/types.js';
import type { Proc123Config } from '../config/types.js';
import { FIELD_PROPERTIES, type TargetField } from '../config/types.js';
import { AI_CONFIDENCE, addUsage, emptyUsage, type AIProvider, type AIUsage } from './types.js';
import { trimFragment, type TrimOptions } from './fragment.js';
import { missingTier1For, needsAI } from './tiers.js';
import { verifyAnswer } from './verify.js';

export interface EnrichOptions extends TrimOptions {
  /** Cap on pages sent in one scan. Cost control the user can see. */
  maxRequests?: number;
  signal?: AbortSignal;
}

export interface EnrichResult {
  products: CanonicalProduct[];
  issues: ExtractionIssue[];
  usage: AIUsage;
  /** Products actually sent, for the report. */
  requested: number;
}

/**
 * Fill one product's empty fields from a verified answer.
 *
 * Returns a copy. Only properties that are currently empty are written, and
 * each one gets a `fieldConfidence` entry so the "why is this field empty?"
 * report can say the value came from the AI rather than from the page's markup.
 */
function fillEmpty(
  product: CanonicalProduct,
  verified: Partial<CanonicalProduct>,
  wanted: readonly TargetField[]
): { product: CanonicalProduct; filled: string[] } {
  const filled: string[] = [];
  const next: CanonicalProduct = {
    ...product,
    extractionMeta: {
      ...product.extractionMeta,
      fieldConfidence: { ...product.extractionMeta.fieldConfidence },
    },
  };
  const target = next as unknown as Record<string, unknown>;
  const source = verified as Record<string, unknown>;
  const allowed = new Set(wanted.flatMap((field) => FIELD_PROPERTIES[field] ?? []));

  for (const [property, value] of Object.entries(source)) {
    if (!allowed.has(property)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;

    const current = target[property];
    const isEmpty =
      current === undefined ||
      (typeof current === 'string' && current.trim() === '') ||
      (Array.isArray(current) && current.length === 0);
    if (!isEmpty) continue;

    target[property] = value;
    next.extractionMeta.fieldConfidence[property] = AI_CONFIDENCE;
    filled.push(property);
  }

  // The layer stamp moves to D only when D actually contributed. A product
  // untouched here keeps saying it came from B, which is true and is what the
  // report should show.
  if (filled.length > 0) next.extractionMeta.layer = 'D';
  return { product: next, filled };
}

/**
 * Run Layer D over one page's products.
 *
 * `page` is the page the products came from: the fragment is trimmed once and
 * reused, because every parent on a product page shares the same markup and
 * sending it twice would double the bill for the same answer.
 */
export async function enrichWithAI(
  products: readonly CanonicalProduct[],
  page: PageContext,
  provider: AIProvider,
  config: Proc123Config,
  options: EnrichOptions = {}
): Promise<EnrichResult> {
  const issues: ExtractionIssue[] = [];
  let usage = emptyUsage(provider.name, provider.model);
  const wanted = config.targetFields;

  if (!config.aiProvider.enabled) {
    return { products: [...products], issues, usage, requested: 0 };
  }

  const candidates = products.filter((product) => needsAI(product, wanted));
  if (candidates.length === 0) {
    return { products: [...products], issues, usage, requested: 0 };
  }

  const fragment = trimFragment(page.html, options);
  if (fragment.html === '') {
    issues.push({
      severity: 'info',
      code: 'ai-no-fragment',
      source: 'ai',
      url: page.url,
      message:
        'The AI step was skipped: no product content could be isolated from this page, ' +
        'and sending the whole page is not allowed.',
    });
    return { products: [...products], issues, usage, requested: 0 };
  }

  const limit = options.maxRequests ?? 1;
  const sent = candidates.slice(0, Math.max(0, limit));
  const byUrl = new Map<CanonicalProduct, Partial<CanonicalProduct>>();
  let requested = 0;

  for (const product of sent) {
    const missing = missingTier1For(product, wanted);
    if (missing.length === 0) continue;

    const result = await provider.extract({
      htmlFragment: fragment.html,
      targetFields: missing,
      sourceUrl: product.sourceUrl,
      ...(page.locale === undefined ? {} : { locale: page.locale }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    requested += 1;
    usage = addUsage(usage, result.usage);
    issues.push(...result.issues);
    if (Object.keys(result.fields).length === 0) continue;

    const verified = verifyAnswer(result.fields, {
      fragment: fragment.html,
      sourceUrl: product.sourceUrl,
      wanted: missing,
    });
    issues.push(...verified.issues);
    byUrl.set(product, verified.fields);
  }

  const out: CanonicalProduct[] = [];
  const filledFields = new Set<string>();
  for (const product of products) {
    const verified = byUrl.get(product);
    if (verified === undefined) {
      out.push(product);
      continue;
    }
    const { product: next, filled } = fillEmpty(product, verified, wanted);
    for (const field of filled) filledFields.add(field);
    out.push(next);
  }

  if (requested > 0) {
    issues.push({
      severity: 'info',
      code: 'ai-usage',
      source: 'ai',
      url: page.url,
      message:
        `AI fallback: ${String(requested)} request(s) to ${provider.name} (${provider.model}), ` +
        `${String(usage.inputTokens)} input + ${String(usage.outputTokens)} output tokens. ` +
        (filledFields.size === 0
          ? 'No fields were filled.'
          : `Filled: ${[...filledFields].join(', ')}.`),
    });
  }
  if (candidates.length > sent.length) {
    issues.push({
      severity: 'info',
      code: 'ai-request-limit',
      source: 'ai',
      url: page.url,
      message:
        `${String(candidates.length - sent.length)} product(s) were left without AI help ` +
        `because the per-page request limit (${String(limit)}) was reached.`,
    });
  }

  return { products: out, issues, usage, requested };
}
