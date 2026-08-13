/**
 * Unit conversion for weights and dimensions.
 *
 * The target store decides what unit its CSV columns are in — WooCommerce names
 * the column `Weight (kg)` or `Weight (lbs)` from its own settings — so a
 * scraped `500 g` has to become `0.5` before it is written. See
 * docs/woocommerce-csv-notes.md.
 */

import type { DimensionUnit, Measure, WeightUnit } from './model.js';
import { roundTo } from './numbers.js';

/** Grams per unit. */
const WEIGHT_IN_GRAMS: Readonly<Record<WeightUnit, number>> = {
  g: 1,
  kg: 1000,
  lbs: 453.59237,
  oz: 28.349523125,
};

/** Millimetres per unit. */
const DIMENSION_IN_MM: Readonly<Record<DimensionUnit, number>> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  yd: 914.4,
};

function convert<U extends string>(
  measure: Measure<U>,
  target: U,
  table: Readonly<Record<U, number>>
): number {
  if (measure.unit === target) return measure.value;
  const from = table[measure.unit];
  const to = table[target];
  return roundTo((measure.value * from) / to, 6);
}

export function convertWeight(measure: Measure<WeightUnit>, target: WeightUnit): number {
  return convert(measure, target, WEIGHT_IN_GRAMS);
}

export function convertDimension(measure: Measure<DimensionUnit>, target: DimensionUnit): number {
  return convert(measure, target, DIMENSION_IN_MM);
}

export function isWeightUnit(value: string): value is WeightUnit {
  return Object.prototype.hasOwnProperty.call(WEIGHT_IN_GRAMS, value);
}

export function isDimensionUnit(value: string): value is DimensionUnit {
  return Object.prototype.hasOwnProperty.call(DIMENSION_IN_MM, value);
}
