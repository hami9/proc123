/**
 * Layer C — applying a learned profile.
 *
 * Once a store has been taught, this is all that runs: find the cards, read the
 * fields, hand back `CanonicalProduct`s like every other layer. It is the
 * cheapest layer in the pipeline and the only one that works on a store which
 * publishes no machine-readable data at all.
 *
 * Confidence sits below OpenGraph on purpose. A profile is a person's best
 * guess at what an element meant, recorded once; markup is the store saying so
 * every time it renders. When both are present, believe the store.
 */

import type { CanonicalProduct } from '../model.js';
import type { FieldRule, ProfileField, SiteProfile } from '@proc123/profiles';
import {
  type CheerioAPI,
  type Element,
  isElement,
  loadHtml,
  readImageUrl,
} from '../extract/html.js';
import {
  type ProductDraft,
  createDraft,
  flattenDraft,
  setField,
  setPricePair,
} from '../extract/draft.js';
import type { ExtractionIssue, ExtractionResult, PageContext } from '../extract/types.js';
import { readAvailability } from '../extract/schema-offers.js';
import { parseMoney } from '../money.js';
import { cleanText } from '../text.js';
import { canonicalizeUrl, resolveUrl } from '../url.js';
import type { ExtractionOptions } from '../extract/types.js';

const SOURCE = 'dom';

/**
 * Below OpenGraph. A profile records what a person believed once; markup is the
 * store restating it on every render, so markup wins where both exist.
 */
export const PROFILE_CONFIDENCE = 0.4;

/** Read one field out of one card. */
function readRule(
  $: CheerioAPI,
  card: Element,
  rule: FieldRule,
  pageUrl: string
): string | undefined {
  const found = $(card).find(rule.selector).first();
  if (found.length === 0) return undefined;

  if (rule.from === 'text') {
    const text = cleanText(found.text());
    return text === '' ? undefined : text;
  }

  const attribute = rule.attribute;
  if (attribute === undefined) return undefined;

  // A profile records `src` for an image, because that is what the element the
  // user clicked appeared to hold. On a lazy-loading theme it holds a 1x1
  // `data:` placeholder and the real URL sits in a data attribute, so reading
  // `src` alone returns either nothing or the same grey pixel for every row.
  // Resolving that here rather than at learn time repairs profiles that were
  // already taught and saved, which is most of them.
  const element = found[0];
  const raw =
    attribute === 'src' && element !== undefined && isElement(element)
      ? readImageUrl(element)
      : found.attr(attribute);
  if (raw === undefined || raw.trim() === '') return undefined;

  // `href` and `src` are relative far more often than not.
  if (attribute === 'href' || attribute === 'src') {
    const resolved = resolveUrl(raw, pageUrl);
    return resolved !== undefined && /^https?:/i.test(resolved) ? resolved : undefined;
  }
  return cleanText(raw);
}

export type ApplyProfileOptions = ExtractionOptions;

/**
 * Run a profile over a page.
 *
 * A card that yields no name is skipped rather than exported blank, the same
 * rule every other layer follows — with one difference: here it usually means
 * the profile has gone stale, so it is counted and reported rather than passed
 * over in silence.
 */
export function extractWithProfile(
  page: PageContext,
  profile: SiteProfile,
  options: ApplyProfileOptions = {}
): ExtractionResult {
  const $ = loadHtml(page.html);
  const issues: ExtractionIssue[] = [];
  const scannedAt = options.scannedAt ?? new Date().toISOString();

  const cards = $(profile.card.container).toArray().filter(isElement);
  if (cards.length === 0) {
    issues.push({
      severity: 'warning',
      kind: 'structure-changed',
      code: 'profile-container-missed',
      url: page.url,
      message:
        `The saved profile for ${profile.domain} looks for "${profile.card.container}" and found ` +
        `nothing on this page. Either this is not a category page, or the store's theme changed ` +
        `and the profile needs teaching again.`,
    });
    return { layer: 'C', products: [], discoveredUrls: [], issues };
  }

  const products: CanonicalProduct[] = [];
  const misses: Partial<Record<ProfileField, number>> = {};
  let nameless = 0;

  for (const card of cards) {
    const values: Partial<Record<ProfileField, string>> = {};
    for (const [field, rule] of Object.entries(profile.card.fields)) {
      const value = readRule($, card, rule, page.url);
      if (value === undefined) {
        misses[field as ProfileField] = (misses[field as ProfileField] ?? 0) + 1;
        continue;
      }
      values[field as ProfileField] = value;
    }

    const name = values.name;
    if (name === undefined) {
      nameless += 1;
      continue;
    }

    const url = values.url ?? page.url;
    const draft: ProductDraft = createDraft(canonicalizeUrl(url));

    setField(draft, 'name', name, PROFILE_CONFIDENCE, SOURCE);
    setField(draft, 'kind', 'simple', PROFILE_CONFIDENCE, SOURCE);
    setField(draft, 'sku', values.sku, PROFILE_CONFIDENCE, SOURCE);
    if (values.image !== undefined) {
      setField(draft, 'images', [values.image], PROFILE_CONFIDENCE, SOURCE);
    }

    const money = (raw: string | undefined): ReturnType<typeof parseMoney> =>
      raw === undefined
        ? undefined
        : parseMoney(raw, {
            // A learned price is display text — `۱٬۵۰۰٬۰۰۰ تومان` — so the same
            // rules Layer B uses for a rendered price apply here.
            ambiguousGrouping: 'thousands',
            ...(options.defaultCurrency === undefined
              ? {}
              : { defaultCurrency: options.defaultCurrency }),
            ...(options.defaultCurrencyUnit === undefined
              ? {}
              : { defaultUnit: options.defaultCurrencyUnit }),
          });

    const regular = money(values.regularPrice);
    const sale = money(values.salePrice);
    setPricePair(draft, { regular: regular?.money, sale: sale?.money }, PROFILE_CONFIDENCE, SOURCE);

    setField(draft, 'inStock', readAvailability(values.availability), PROFILE_CONFIDENCE, SOURCE);

    products.push(...flattenDraft(draft, { layer: 'C', scannedAt }));
  }

  // A field missing from every card is a broken rule; missing from some is a
  // catalogue where not every product has it, which is normal.
  for (const [field, count] of Object.entries(misses)) {
    if (count < cards.length) continue;
    const rule = profile.card.fields[field as ProfileField];
    issues.push({
      severity: 'warning',
      kind: 'structure-changed',
      code: 'profile-field-missed',
      url: page.url,
      message:
        `The profile's rule for "${field}" ("${rule?.selector ?? '?'}") matched nothing on any of ` +
        `the ${String(cards.length)} cards found. It probably needs teaching again.`,
    });
  }

  if (nameless > 0) {
    issues.push({
      severity: 'warning',
      code: 'profile-nameless-cards',
      url: page.url,
      message:
        `${String(nameless)} of ${String(cards.length)} cards had no name and were skipped. ` +
        `If that is most of them, the container selector is matching the wrong thing.`,
    });
  }

  return { layer: 'C', products, discoveredUrls: [], issues };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface ProfileHealth {
  domain: string;
  /** Cards the container selector found. */
  cardCount: number;
  /** Fields whose rule matched nothing at all. */
  brokenFields: ProfileField[];
  /** Fields that matched on some cards but not others. */
  partialFields: ProfileField[];
  healthy: boolean;
  summary: string;
}

/**
 * Check a profile against a page it should work on (CLAUDE.md §11).
 *
 * Meant to be run on a schedule or before a big scan, so that "this profile has
 * quietly stopped working" is something the user is told rather than something
 * they infer from an empty CSV.
 */
export function checkProfileHealth(page: PageContext, profile: SiteProfile): ProfileHealth {
  const $ = loadHtml(page.html);
  const cards = $(profile.card.container).toArray().filter(isElement);

  const broken: ProfileField[] = [];
  const partial: ProfileField[] = [];

  for (const [field, rule] of Object.entries(profile.card.fields)) {
    const hits = cards.filter((card) => readRule($, card, rule, page.url) !== undefined).length;
    if (hits === 0) broken.push(field as ProfileField);
    else if (hits < cards.length) partial.push(field as ProfileField);
  }

  const healthy = cards.length > 0 && broken.length === 0;

  const summary =
    cards.length === 0
      ? `"${profile.card.container}" matched no product cards — the profile needs teaching again.`
      : broken.length > 0
        ? `${String(cards.length)} cards found, but ${broken.join(', ')} matched nothing.`
        : partial.length > 0
          ? `${String(cards.length)} cards found; ${partial.join(', ')} is missing from some of them, which is often normal.`
          : `${String(cards.length)} cards found and every rule matched.`;

  return {
    domain: profile.domain,
    cardCount: cards.length,
    brokenFields: broken,
    partialFields: partial,
    healthy,
    summary,
  };
}
