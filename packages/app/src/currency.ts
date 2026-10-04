/**
 * The toman/rial question — CLAUDE.md §7.8 and §18.
 *
 * This is the single worst silent failure this project can produce. A shop
 * quotes `۴۲۰,۰۰۰` and means toman; read as rial it becomes 42,000 toman, and
 * every price in the imported catalogue is wrong by a factor of ten. Nothing
 * downstream catches it — the CSV is valid, the import succeeds, and the shop
 * finds out from a customer.
 *
 * So §18 requires a deliberate, unmissable step before any export, on every
 * surface, and is explicit that it must never be "a checkbox someone can skip
 * past". Two things follow, and both are enforced here rather than left to the
 * view:
 *
 * 1. **There is no default.** `undefined` means unanswered, and unanswered
 *    blocks export. A pre-selected radio button would be a guess wearing the
 *    costume of a decision.
 * 2. **The question is only asked when it is real.** If every price already
 *    states its unit, there is nothing to confirm and interrupting the user
 *    teaches them to dismiss the step — which is how a safety prompt stops
 *    working.
 */

import type { CanonicalProduct, CurrencyUnit, Money } from '@proc123/core';
import { convertCurrencyUnit, hasUnit, isIranianCurrency } from '@proc123/core';

export interface CurrencyQuestion {
  /** True when at least one price is IRR with no unit stated. */
  needed: boolean;
  /** How many prices are unanswered, for the explanation. */
  unstated: number;
  /** A unit the pages did state, if any — shown as what the shop implied. */
  stated?: CurrencyUnit;
  /** The first unstated amount, so the two readings can be shown side by side. */
  sample?: number;
}

function pricesOf(product: CanonicalProduct): (CanonicalProduct['regularPrice'] | undefined)[] {
  return [product.regularPrice, product.salePrice];
}

/** Work out whether the question has to be asked, and what to illustrate with. */
export function currencyQuestion(products: readonly CanonicalProduct[]): CurrencyQuestion {
  let unstated = 0;
  let stated: CurrencyUnit | undefined;
  let sample: number | undefined;

  for (const product of products) {
    for (const price of pricesOf(product)) {
      if (price === undefined) continue;
      if (!isIranianCurrency(price.currency)) continue;

      if (price.unit === undefined) {
        unstated += 1;
        sample ??= price.amount;
      } else {
        stated ??= price.unit;
      }
    }
  }

  return {
    needed: unstated > 0,
    unstated,
    ...(stated === undefined ? {} : { stated }),
    ...(sample === undefined ? {} : { sample }),
  };
}

/**
 * The two readings of the same number, so the choice is concrete.
 *
 * Showing "420,000 toman" against "42,000 toman" is what makes the ten-times
 * difference visible. A label saying only "toman" or "rial" asks the user to do
 * that arithmetic in their head, and they will not.
 */
export function readingsOf(
  amount: number,
  outputUnit: CurrencyUnit = 'toman'
): Record<CurrencyUnit, number> {
  return {
    toman: convertCurrencyUnit({ amount, currency: 'IRR', unit: 'toman' }, outputUnit).amount,
    rial: convertCurrencyUnit({ amount, currency: 'IRR', unit: 'rial' }, outputUnit).amount,
  };
}

/** Annotate unstated source units, never replace a unit the page supplied. */
function confirmedPrice(price: Money, answer: CurrencyUnit | undefined): Money {
  return answer !== undefined && price.unit === undefined && isIranianCurrency(price.currency)
    ? { ...price, unit: answer }
    : price;
}

/** The table and exporter must show the same converted price after confirmation. */
export function priceForDisplay(
  price: Money,
  answer: CurrencyUnit | undefined,
  outputUnit: CurrencyUnit
): Money {
  const confirmed = confirmedPrice(price, answer);
  return isIranianCurrency(confirmed.currency) && hasUnit(confirmed)
    ? convertCurrencyUnit(confirmed, outputUnit)
    : confirmed;
}

export function confirmedProducts(
  products: readonly CanonicalProduct[],
  answer: CurrencyUnit | undefined
): CanonicalProduct[] {
  return products.map((product) => ({
    ...product,
    ...(product.regularPrice === undefined
      ? {}
      : { regularPrice: confirmedPrice(product.regularPrice, answer) }),
    ...(product.salePrice === undefined
      ? {}
      : { salePrice: confirmedPrice(product.salePrice, answer) }),
  }));
}

/**
 * Whether an export may proceed.
 *
 * Exported as its own function because it is the rule, and a view that forgot
 * to check it would reintroduce exactly the failure this file exists to
 * prevent. The rule is: if the question is real, it must have been answered.
 */
export function canExport(question: CurrencyQuestion, answer: CurrencyUnit | undefined): boolean {
  return !question.needed || answer !== undefined;
}
