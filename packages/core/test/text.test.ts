import { describe, expect, it } from 'vitest';

import { cleanText, foldForCompare, hasNonAscii, shortHash, slugify } from '@proc123/core';

const ZWNJ = String.fromCodePoint(0x200c);
const RLM = String.fromCodePoint(0x200f);
const NBSP = String.fromCodePoint(0x00a0);

describe('cleanText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanText('  گردو   تازه  ')).toBe('گردو تازه');
    expect(cleanText(`500${NBSP}گرم`)).toBe('500 گرم');
  });

  it('strips bidi marks injected by RTL themes', () => {
    expect(cleanText(`${RLM}گردو${RLM}`)).toBe('گردو');
  });

  it('preserves ZWNJ, which changes Persian spelling', () => {
    const word = `می${ZWNJ}رود`;
    expect(cleanText(word)).toBe(word);
  });

  it('normalizes to NFC so equal-looking strings compare equal', () => {
    const decomposed = 'éclair';
    expect(cleanText(decomposed)).toBe('éclair');
  });
});

describe('foldForCompare', () => {
  it('folds Arabic letter forms onto Persian ones', () => {
    // Same attribute name typed with an Arabic keyboard.
    expect(foldForCompare('کيفيت')).toBe(foldForCompare('کیفیت'));
    expect(foldForCompare('كیفیت')).toBe(foldForCompare('کیفیت'));
  });

  it('ignores ZWNJ and diacritics when comparing', () => {
    expect(foldForCompare(`می${ZWNJ}رود`)).toBe(foldForCompare('میرود'));
    expect(foldForCompare('اَنار')).toBe(foldForCompare('انار'));
  });

  it('lowercases Latin text', () => {
    expect(foldForCompare('Size')).toBe(foldForCompare('SIZE'));
  });

  it('does not equate genuinely different words', () => {
    expect(foldForCompare('گردو')).not.toBe(foldForCompare('بادام'));
  });
});

describe('slugify', () => {
  it('keeps Persian text by default', () => {
    expect(slugify('500 گرم')).toBe('500-گرم');
  });

  it('lowercases and dashes Latin text', () => {
    expect(slugify('Large / Red')).toBe('large-red');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
  });

  it('strips leading and trailing separators', () => {
    expect(slugify('--x--')).toBe('x');
    expect(slugify('!!!')).toBe('');
  });

  it('falls back to a hash when ASCII output is required', () => {
    const hash = (input: string): string => shortHash(input, 6);
    expect(slugify('500 گرم', { ascii: true, hash })).toBe(hash('500 گرم'));
    // Text that is already ASCII is left alone even in ascii mode.
    expect(slugify('Large', { ascii: true, hash })).toBe('large');
  });
});

describe('hasNonAscii', () => {
  it('detects non-ASCII text', () => {
    expect(hasNonAscii('گردو')).toBe(true);
    expect(hasNonAscii('walnut')).toBe(false);
  });
});

describe('HTML entities in scraped text', () => {
  // Found by a real scan. An SEO plugin writes the product name into JSON-LD
  // with HTML escapes intact, and `JSON.parse` has no reason to undo them — so
  // the en-dash reached the CSV as seven literal characters.
  it('decodes a numeric entity that JSON-LD carried through', () => {
    expect(cleanText('تک سیم کارت فیزیکی &#8211; Not Active')).toBe(
      'تک سیم کارت فیزیکی – Not Active'
    );
  });

  it('decodes the named entities a storefront actually emits', () => {
    expect(cleanText('Tea &amp; Nuts')).toBe('Tea & Nuts');
    expect(cleanText('50&nbsp;گرم')).toBe('50 گرم');
    expect(cleanText('&quot;ویژه&quot;')).toBe('"ویژه"');
  });

  it('leaves text that merely looks like an entity alone', () => {
    expect(cleanText('price & up')).toBe('price & up');
    expect(cleanText('R&D')).toBe('R&D');
  });

  it('decodes parent options and variation values identically — §7.6', () => {
    // The rule this must not break: both sides pass through `cleanText`, so a
    // decoded variation value still matches the decoded parent option
    // character-for-character. Decoding only one side would be worse than
    // decoding neither.
    const parentOption = cleanText('رجیستر شده &#43; گارانتی');
    const variationValue = cleanText('رجیستر شده &#43; گارانتی');
    expect(variationValue).toBe(parentOption);
    expect(parentOption).toContain('+');
  });
});
