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
