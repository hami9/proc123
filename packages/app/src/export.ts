/** The user's source-unit answer is separate from the destination store unit. */
import type { CanonicalProduct, CurrencyUnit, Proc123Config } from '@proc123/core';
import { exportProducts, type ExportOutcome } from '@proc123/exporters';
import { canExport, confirmedProducts, currencyQuestion } from './currency.js';

export function exportScan(
  products: readonly CanonicalProduct[],
  config: Proc123Config,
  sourceUnit: CurrencyUnit | undefined,
  scannedUrl: string
): ExportOutcome {
  if (!canExport(currencyQuestion(products), sourceUnit)) {
    throw new Error('Confirm the source price unit before exporting.');
  }
  const shared = {
    displayUnit: config.currency.displayUnit,
    currencyCode: config.currency.code,
    strictCurrencyUnit: true,
    contentMode: config.contentMode,
    bom: true,
  };
  return exportProducts(confirmedProducts(products, sourceUnit), config.exporter, {
    woocommerce: shared,
    shopify: shared,
    json: { scannedUrl },
  });
}
