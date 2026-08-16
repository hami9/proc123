/**
 * Site profiles — what proc123 learns when a user teaches it a store.
 *
 * CLAUDE.md §4 Layer C: "Profiles must be human-readable JSON, exportable and
 * importable." So the shape here is written to be read and edited by a person
 * who has never seen this codebase, and to survive being emailed between two of
 * them. Everything is a plain string or a small object; nothing is encoded,
 * minified, or keyed by anything but a name.
 *
 * This package deliberately has no dependencies. A profile is data, and the
 * schema for it should not drag a parser, a model, or a browser along with it.
 */

/** Bumped when the shape changes incompatibly. Older files are refused, not guessed at. */
export const PROFILE_VERSION = 1;

/** Where a field's value is read from once its element has been found. */
export type FieldSource =
  /** The element's visible text. */
  | 'text'
  /** A named attribute — `src`, `href`, `content`, `datetime`. */
  | 'attribute';

export interface FieldRule {
  /** A CSS selector, relative to the product card. */
  selector: string;
  from: FieldSource;
  /** Required when `from` is `attribute`. */
  attribute?: string;
  /**
   * Why this selector was chosen, in plain words. Written when the profile is
   * learned so that a person editing it later knows what it was aiming at.
   */
  note?: string;
}

/**
 * The fields a profile can teach. Deliberately a subset of `CanonicalProduct`:
 * these are the ones a person can point at on a product card.
 */
export type ProfileField =
  'name' | 'url' | 'image' | 'regularPrice' | 'salePrice' | 'sku' | 'availability';

export type FieldRules = Partial<Record<ProfileField, FieldRule>>;

export interface CardRule {
  /** Selector matching one product card. Applied to the whole page. */
  container: string;
  fields: FieldRules;
}

export interface SiteProfile {
  version: number;
  /** Hostname the profile is for, lowercased and without `www.`. */
  domain: string;
  /** A human label, for a list of saved profiles. */
  label?: string;
  card: CardRule;
  /** Selector for the next-page link, when the crawler could not find one itself. */
  pagination?: { next: string };
  /** Free text: how it was made, what is odd about this store. */
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `www.Shop.Example` and `shop.example/c/nuts` both key the same profile. */
export function profileDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  try {
    return new URL(trimmed).hostname.replace(/^www\./, '');
  } catch {
    return (
      trimmed
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0] ?? trimmed
    );
  }
}

export interface ValidationResult {
  valid: boolean;
  /** Every problem, not just the first — a person fixing a file wants them all. */
  errors: string[];
}

const FIELDS: readonly ProfileField[] = [
  'name',
  'url',
  'image',
  'regularPrice',
  'salePrice',
  'sku',
  'availability',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkField(name: string, rule: unknown, errors: string[]): void {
  if (!isRecord(rule)) {
    errors.push(`field "${name}" must be an object`);
    return;
  }
  if (typeof rule['selector'] !== 'string' || rule['selector'].trim() === '') {
    errors.push(`field "${name}" needs a non-empty selector`);
  }
  if (rule['from'] !== 'text' && rule['from'] !== 'attribute') {
    errors.push(`field "${name}" must read from "text" or "attribute"`);
  }
  if (rule['from'] === 'attribute' && typeof rule['attribute'] !== 'string') {
    errors.push(`field "${name}" reads an attribute but does not say which`);
  }
}

/**
 * Check a parsed profile.
 *
 * Strict about the things that would fail silently — a missing `attribute`, an
 * unknown field name — and quiet about the things that are merely unusual, so
 * that a hand-written profile is not rejected for being terse.
 */
export function validateProfile(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) return { valid: false, errors: ['a profile must be a JSON object'] };

  if (value['version'] !== PROFILE_VERSION) {
    errors.push(
      `unsupported profile version ${String(value['version'])}; this build reads version ${String(PROFILE_VERSION)}`
    );
  }
  if (typeof value['domain'] !== 'string' || value['domain'].trim() === '') {
    errors.push('a profile needs a domain');
  }

  const card = value['card'];
  if (!isRecord(card)) {
    errors.push('a profile needs a "card" section');
    return { valid: false, errors };
  }

  if (typeof card['container'] !== 'string' || card['container'].trim() === '') {
    errors.push('card.container must be a selector matching one product card');
  }

  const fields = card['fields'];
  if (!isRecord(fields)) {
    errors.push('card.fields must be an object');
    return { valid: errors.length === 0, errors };
  }

  for (const [name, rule] of Object.entries(fields)) {
    if (!FIELDS.includes(name as ProfileField)) {
      errors.push(`unknown field "${name}"; known fields are ${FIELDS.join(', ')}`);
      continue;
    }
    checkField(name, rule, errors);
  }

  // A card with no name is a card with no product: every other field describes
  // something that has to have been identified first.
  if (fields['name'] === undefined) {
    errors.push('card.fields must include "name" — a product without one cannot be exported');
  }

  const pagination = value['pagination'];
  if (pagination !== undefined) {
    if (!isRecord(pagination) || typeof pagination['next'] !== 'string') {
      errors.push('pagination must be an object with a "next" selector');
    }
  }

  return { valid: errors.length === 0, errors };
}

export class ProfileParseError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`This is not a valid proc123 profile:\n- ${errors.join('\n- ')}`);
    this.name = 'ProfileParseError';
    this.errors = errors;
  }
}

/** Read a profile from the JSON a user pasted or imported. Throws with every problem. */
export function parseProfile(json: string): SiteProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new ProfileParseError([
      `the file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  const { valid, errors } = validateProfile(parsed);
  if (!valid) throw new ProfileParseError(errors);
  return parsed as SiteProfile;
}

/**
 * Write a profile out for a human.
 *
 * Two spaces and a trailing newline, so it diffs cleanly in a repository — a
 * profile is exactly the kind of thing a team keeps under version control.
 */
export function serializeProfile(profile: SiteProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** The filename a profile belongs under: `profiles/{domain}.json`. */
export function profileFilename(profile: SiteProfile): string {
  return `${profileDomain(profile.domain)}.json`;
}
