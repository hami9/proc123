/**
 * Which platform built this store.
 *
 * Detection reads the page the user already has open — no request, so no risk
 * of tripping anything, and no cost. Every signal that fires is kept, because
 * "why did it pick Shopify?" is a question the troubleshooting report has to be
 * able to answer (CLAUDE.md §11).
 *
 * All detections are returned, best first, rather than just the winner. A
 * headless storefront is genuinely both Next.js and Shopify, and the caller
 * should get to try one adapter and then the other.
 */

import type { CheerioAPI } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';
import {
  type Signal,
  bodyClass,
  generator,
  includes,
  makeContext,
  runSignals,
  selector,
} from '../inspect/signals.js';
import type { PlatformDetection, PlatformId } from './types.js';

/**
 * Adapters exist for these. The rest are detected so the report can say "this is
 * Magento, Layer A has no adapter for it yet, Layer B handled it" instead of
 * silently falling through.
 */
const ADAPTER_AVAILABLE: ReadonlySet<PlatformId> = new Set<PlatformId>([
  'woocommerce',
  'shopify',
  'nextjs',
  'nuxt',
]);

const SIGNALS: Readonly<Record<Exclude<PlatformId, 'unknown'>, readonly Signal[]>> = {
  woocommerce: [
    { label: 'generator meta names WooCommerce', weight: 0.6, test: generator('woocommerce') },
    { label: 'body class woocommerce', weight: 0.5, test: bodyClass('woocommerce') },
    { label: 'body class woocommerce-page', weight: 0.3, test: bodyClass('woocommerce-page') },
    {
      label: 'wp-content/plugins/woocommerce asset',
      weight: 0.5,
      test: includes('/plugins/woocommerce/'),
    },
    { label: 'Store API path in page', weight: 0.6, test: includes('/wp-json/wc/store/') },
    { label: 'wc_add_to_cart_params', weight: 0.4, test: includes('wc_add_to_cart_params') },
    { label: 'woocommerce_params', weight: 0.4, test: includes('woocommerce_params') },
    { label: 'wp-block-woocommerce markup', weight: 0.25, test: includes('wp-block-woocommerce') },
    {
      label: 'WordPress REST link header',
      weight: 0.15,
      test: selector('link[rel="https://api.w.org/"]'),
    },
  ],
  shopify: [
    {
      label: 'shopify-digital-wallet meta',
      weight: 0.6,
      test: selector('#shopify-digital-wallet'),
    },
    { label: 'Shopify JS global', weight: 0.6, test: includes('shopify.shop') },
    { label: 'cdn.shopify.com asset', weight: 0.5, test: includes('cdn.shopify.com') },
    { label: 'cdn.shopifycloud.com asset', weight: 0.4, test: includes('cdn.shopifycloud.com') },
    { label: '/cdn/shop/ asset path', weight: 0.4, test: includes('/cdn/shop/') },
    { label: 'myshopify.com host', weight: 0.4, test: includes('myshopify.com') },
    { label: 'shopify-features script', weight: 0.3, test: selector('#shopify-features') },
  ],
  magento: [
    { label: 'x-magento-init script', weight: 0.6, test: includes('text/x-magento-init') },
    { label: 'Magento_ JS module', weight: 0.4, test: includes('magento_') },
    { label: '/static/version asset path', weight: 0.4, test: includes('/static/version') },
    { label: 'generator meta names Magento', weight: 0.6, test: generator('magento') },
  ],
  nextjs: [
    { label: '__NEXT_DATA__ script', weight: 0.7, test: selector('script#__NEXT_DATA__') },
    { label: '/_next/static asset path', weight: 0.4, test: includes('/_next/static') },
  ],
  nuxt: [
    { label: '__NUXT__ state global', weight: 0.7, test: includes('window.__nuxt__') },
    { label: '/_nuxt/ asset path', weight: 0.4, test: includes('/_nuxt/') },
    { label: 'nuxt-data script', weight: 0.5, test: selector('script#__NUXT_DATA__') },
  ],
  prestashop: [
    { label: 'generator meta names PrestaShop', weight: 0.6, test: generator('prestashop') },
    { label: 'prestashop JS global', weight: 0.6, test: includes('var prestashop') },
    { label: '/modules/ps_ asset', weight: 0.3, test: includes('/modules/ps_') },
  ],
  opencart: [
    { label: 'generator meta names OpenCart', weight: 0.6, test: generator('opencart') },
    { label: 'catalog/view/theme asset', weight: 0.5, test: includes('catalog/view/theme/') },
    { label: 'index.php?route= link', weight: 0.3, test: includes('index.php?route=') },
  ],
};

/**
 * Every platform the page shows evidence for, most confident first.
 *
 * An empty list means "custom build", which is the majority of the web and the
 * reason Layer B exists.
 */
export function detectPlatforms(page: PageContext, $: CheerioAPI): PlatformDetection[] {
  const context = makeContext(page, $);
  const found: PlatformDetection[] = [];

  for (const [platform, signals] of Object.entries(SIGNALS)) {
    const result = runSignals(signals, context);
    if (result === undefined) continue;

    const id = platform as Exclude<PlatformId, 'unknown'>;
    found.push({
      platform: id,
      confidence: result.confidence,
      signals: result.signals,
      adapterAvailable: ADAPTER_AVAILABLE.has(id),
    });
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}

/** The single best guess, or `unknown` when nothing fired convincingly. */
export function detectPlatform(page: PageContext, $: CheerioAPI): PlatformDetection {
  const [best] = detectPlatforms(page, $);
  return best ?? { platform: 'unknown', confidence: 0, signals: [], adapterAvailable: false };
}
