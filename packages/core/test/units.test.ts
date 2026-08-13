import { describe, expect, it } from 'vitest';

import { convertDimension, convertWeight, isDimensionUnit, isWeightUnit } from '@proc123/core';

describe('convertWeight', () => {
  it('is a no-op for the same unit', () => {
    expect(convertWeight({ value: 1.25, unit: 'kg' }, 'kg')).toBe(1.25);
  });

  it.each([
    [{ value: 500, unit: 'g' } as const, 'kg' as const, 0.5],
    [{ value: 1, unit: 'kg' } as const, 'g' as const, 1000],
    [{ value: 1, unit: 'lbs' } as const, 'kg' as const, 0.453592],
    [{ value: 16, unit: 'oz' } as const, 'lbs' as const, 1],
    [{ value: 1, unit: 'kg' } as const, 'lbs' as const, 2.204623],
  ])('converts %o to %s', (measure, target, expected) => {
    expect(convertWeight(measure, target)).toBeCloseTo(expected, 5);
  });
});

describe('convertDimension', () => {
  it.each([
    [{ value: 250, unit: 'mm' } as const, 'cm' as const, 25],
    [{ value: 1, unit: 'm' } as const, 'cm' as const, 100],
    [{ value: 1, unit: 'in' } as const, 'cm' as const, 2.54],
    [{ value: 1, unit: 'yd' } as const, 'm' as const, 0.9144],
    [{ value: 12, unit: 'in' } as const, 'yd' as const, 0.333333],
  ])('converts %o to %s', (measure, target, expected) => {
    expect(convertDimension(measure, target)).toBeCloseTo(expected, 5);
  });

  it('round-trips within its documented 6-decimal precision', () => {
    // Results are rounded to 6 dp to kill float dust, so a round trip is
    // accurate to ~1e-5 — far below anything that matters for a product weight.
    const inches = convertDimension({ value: 25, unit: 'cm' }, 'in');
    expect(convertDimension({ value: inches, unit: 'in' }, 'cm')).toBeCloseTo(25, 4);
  });

  it('never emits float dust', () => {
    expect(convertWeight({ value: 500, unit: 'g' }, 'kg')).toBe(0.5);
    expect(convertDimension({ value: 3, unit: 'm' }, 'cm')).toBe(300);
  });
});

describe('unit guards', () => {
  it('recognizes known units', () => {
    expect(isWeightUnit('kg')).toBe(true);
    expect(isWeightUnit('stone')).toBe(false);
    expect(isDimensionUnit('cm')).toBe(true);
    expect(isDimensionUnit('furlong')).toBe(false);
  });
});
