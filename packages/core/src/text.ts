/**
 * Text normalization shared by every extraction layer.
 *
 * Scraped storefront text arrives full of things that break naive string
 * comparison: bidi control characters injected by RTL themes, non-breaking
 * spaces from price widgets, Arabic letter forms mixed into Persian text, and
 * zero-width non-joiners that are semantically meaningful in Persian but must
 * be ignored when comparing two spellings of the same attribute name.
 *
 * Every character class here is built from code points rather than written as
 * literals: the characters involved are invisible in an editor, survive neither
 * copy/paste nor review, and a stray one would silently change behaviour.
 */

type CodePointRange = readonly [start: number, end: number];

function charClass(ranges: readonly CodePointRange[]): string {
  return ranges
    .map(([start, end]) =>
      start === end
        ? String.fromCodePoint(start)
        : `${String.fromCodePoint(start)}-${String.fromCodePoint(end)}`
    )
    .join('');
}

/**
 * Format/control characters that carry no meaning in extracted text.
 *
 * ZWNJ (U+200C) and ZWJ (U+200D) are deliberately absent: ZWNJ changes Persian
 * spelling and ZWJ holds emoji sequences together.
 */
const INVISIBLE_RANGES: readonly CodePointRange[] = [
  [0x200b, 0x200b], // ZERO WIDTH SPACE
  [0x200e, 0x200f], // LEFT-TO-RIGHT MARK, RIGHT-TO-LEFT MARK
  [0x202a, 0x202e], // bidi embedding and override
  [0x2060, 0x2064], // WORD JOINER and invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // ZERO WIDTH NO-BREAK SPACE / BOM
];

/** Arabic harakat, superscript alef, Quranic marks and tatweel — decorative here. */
const DIACRITIC_RANGES: readonly CodePointRange[] = [
  [0x0610, 0x061a], // Arabic honorific signs
  [0x0640, 0x0640], // TATWEEL
  [0x064b, 0x065f], // harakat
  [0x0670, 0x0670], // SUPERSCRIPT ALEF
  [0x06d6, 0x06ed], // Quranic annotation marks
];

/** Arabic letter forms that Persian stores use interchangeably with the Persian ones. */
const LETTER_FOLDING: readonly CodePointRange[] = [
  [0x064a, 0x06cc], // ARABIC YEH          -> FARSI YEH
  [0x0649, 0x06cc], // ALEF MAKSURA        -> FARSI YEH
  [0x0643, 0x06a9], // ARABIC KAF          -> KEHEH
  [0x06c0, 0x0647], // HEH WITH YEH ABOVE  -> HEH
  [0x0629, 0x0647], // TEH MARBUTA         -> HEH
];

const INVISIBLE = new RegExp(`[${charClass(INVISIBLE_RANGES)}]`, 'g');
const DIACRITICS = new RegExp(`[${charClass(DIACRITIC_RANGES)}]`, 'g');
const ZWNJ = new RegExp(String.fromCodePoint(0x200c), 'g');

const ARABIC_TO_PERSIAN: ReadonlyMap<string, string> = new Map(
  LETTER_FOLDING.map(([from, to]) => [String.fromCodePoint(from), String.fromCodePoint(to)])
);

/** JS `\s` already covers NBSP, en/em spaces, narrow NBSP and ideographic space. */
const WHITESPACE = /\s+/g;

/**
 * Clean scraped display text without changing what it says.
 *
 * Safe for values that end up in the export: it normalizes Unicode to NFC,
 * drops invisible control characters, collapses runs of whitespace (including
 * the non-breaking spaces price widgets love) and trims.
 */
export function cleanText(input: string): string {
  return input.normalize('NFC').replace(INVISIBLE, '').replace(WHITESPACE, ' ').trim();
}

/**
 * Aggressively fold text for equality comparison only.
 *
 * Never write the result of this into an export — WooCommerce matches variation
 * attribute values against the parent's option list character-for-character, so
 * exported values must keep their original spelling. This exists to decide
 * whether two scraped spellings mean the same thing.
 */
export function foldForCompare(input: string): string {
  const cleaned = cleanText(input).replace(DIACRITICS, '').replace(ZWNJ, '');
  let out = '';
  for (const char of cleaned) {
    out += ARABIC_TO_PERSIAN.get(char) ?? char;
  }
  return out.toLowerCase().replace(WHITESPACE, ' ').trim();
}

const NON_SLUG = /[^\p{L}\p{N}]+/gu;
const NON_ASCII = /[^\x20-\x7E]/;

export interface SlugifyOptions {
  /**
   * Replace the slug with a hash when the source text is not representable in
   * ASCII. Off by default: WooCommerce stores SKUs as post meta and handles
   * UTF-8 fine, and `P123-a1b2c3d4-500-gram-in-persian` is readable to the
   * people using this tool in a way that `P123-a1b2c3d4-7f3a91` is not.
   */
  ascii?: boolean;
  /** Hash used for the ASCII fallback. Required for `ascii` to do anything useful. */
  hash?: (input: string) => string;
}

/** Lowercase, strip punctuation, join with dashes. Unicode letters survive by default. */
export function slugify(input: string, options: SlugifyOptions = {}): string {
  const slug = foldForCompare(input)
    .replace(NON_SLUG, '-')
    .replace(/^-+|-+$/g, '');

  if (options.ascii === true && NON_ASCII.test(slug)) {
    return options.hash?.(input) ?? '';
  }
  return slug;
}

/** True when the string contains at least one character outside printable ASCII. */
export function hasNonAscii(input: string): boolean {
  return NON_ASCII.test(input);
}
