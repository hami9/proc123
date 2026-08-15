import { describe, expect, it } from 'vitest';

import {
  asArray,
  asBoolean,
  asNumber,
  asObjects,
  asText,
  isJsonObject,
  parseJsonLenient,
} from '@proc123/core';

describe('isJsonObject', () => {
  it('separates objects from arrays and null', () => {
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject('x')).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});

describe('asArray', () => {
  it('wraps a single value, because schema.org allows either form', () => {
    expect(asArray('a')).toEqual(['a']);
    expect(asArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops nulls rather than passing them on', () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(['a', null, 'b'])).toEqual(['a', 'b']);
  });

  it('keeps 0 and false, which are values', () => {
    expect(asArray(0)).toEqual([0]);
    expect(asArray(false)).toEqual([false]);
  });
});

describe('asObjects', () => {
  it('keeps only the object members', () => {
    expect(asObjects([{ a: 1 }, 'x', null, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('asText', () => {
  it('cleans strings and stringifies numbers', () => {
    expect(asText('  گردو  ')).toBe('گردو');
    expect(asText('a\n\n b')).toBe('a b');
    expect(asText(1500)).toBe('1500');
  });

  it('treats blank and non-textual values as absent', () => {
    expect(asText('   ')).toBeUndefined();
    expect(asText(true)).toBeUndefined();
    expect(asText(null)).toBeUndefined();
    expect(asText(undefined)).toBeUndefined();
    expect(asText(Number.NaN)).toBeUndefined();
  });
});

describe('asNumber', () => {
  it('reads numbers written either way', () => {
    expect(asNumber(1500)).toBe(1500);
    expect(asNumber('1500')).toBe(1500);
    expect(asNumber('19.99')).toBe(19.99);
    expect(asNumber('۱۵۰۰')).toBe(1500);
  });

  it('returns undefined rather than NaN', () => {
    expect(asNumber('none')).toBeUndefined();
    expect(asNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(asNumber(null)).toBeUndefined();
  });
});

describe('asBoolean', () => {
  it('reads the spellings schema.org markup uses', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean('True')).toBe(true);
    expect(asBoolean('1')).toBe(true);
    expect(asBoolean('no')).toBe(false);
    expect(asBoolean(0)).toBe(false);
    expect(asBoolean('maybe')).toBeUndefined();
  });
});

describe('parseJsonLenient', () => {
  it('parses valid JSON', () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ value: { a: 1 } });
  });

  it('unwraps CDATA and HTML comment guards', () => {
    expect(parseJsonLenient('<!-- {"a":1} -->').value).toEqual({ a: 1 });
    expect(parseJsonLenient('//<![CDATA[\n{"a":1}\n//]]>').value).toEqual({ a: 1 });
  });

  it('repairs the trailing comma a template loop leaves behind', () => {
    const result = parseJsonLenient('{"a":1,"b":[1,2,],}');
    expect(result.value).toEqual({ a: 1, b: [1, 2] });
    expect(result.repaired).toBe(true);
  });

  it('never treats a comma inside a string as a trailing comma', () => {
    const result = parseJsonLenient('{"price":"1,500","note":"ends with a comma, }",}');
    expect(result.value).toEqual({ price: '1,500', note: 'ends with a comma, }' });
  });

  it('leaves escaped quotes inside strings alone', () => {
    const result = parseJsonLenient('{"name":"say \\"hi\\", loudly",}');
    expect(result.value).toEqual({ name: 'say "hi", loudly' });
  });

  it('reports rather than throws on JSON it cannot rescue', () => {
    const result = parseJsonLenient('{"a":1,,}');
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTypeOf('string');
  });

  it('reports an empty block', () => {
    expect(parseJsonLenient('   ').error).toBe('empty script block');
  });
});
