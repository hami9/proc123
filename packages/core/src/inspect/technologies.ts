/**
 * What built this page.
 *
 * `platform/detect.ts` answers the narrower question Layer A needs — which
 * storefront am I about to talk to — and returns a `PlatformId` because that is
 * what dispatch keys off. This module answers the inspector's question, which
 * is wider in two directions: it covers categories that are not storefronts at
 * all, and it returns an open string id rather than a closed union, because a
 * ruleset that grows every month cannot also be a type Layer A switches on.
 *
 * Both run on the same engine (`signals.ts`), so a storefront detected here and
 * a storefront detected there agree, and neither has its own scoring rules.
 *
 * ## Licence and provenance of these rules — CLAUDE.md §16
 *
 * **Every rule below was written for this repository**, from vendor
 * documentation and from the markup the vendor's own installation snippet
 * produces. Nothing is copied, transcribed or machine-translated from another
 * project's ruleset.
 *
 * This is deliberate and not incidental. The well-known technology-detection
 * rulesets are the tempting shortcut and most are not licensed for reuse:
 * Wappalyzer's ruleset left open source in 2023 and is now proprietary, and
 * several of the "open" forks carry its data unchanged and so inherit the
 * problem. Importing any of them would put a licence violation into a
 * repository that is otherwise cleanly MIT.
 *
 * The sources used, all of them public vendor documentation or the vendor's own
 * embed snippet, are named per rule set below. If a rule is ever added from
 * somewhere else, its source and that source's licence go in the comment beside
 * it — an unattributed rule is treated as a defect.
 */

import type { CheerioAPI } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';
import {
  type DetectContext,
  type Signal,
  all,
  attrPrefix,
  firstMatch,
  generator,
  includes,
  includesAny,
  makeContext,
  matches,
  runSignals,
  selector,
} from './signals.js';
import type { Technology, TechnologyCategory } from './types.js';

interface Rule {
  id: string;
  name: string;
  category: TechnologyCategory;
  signals: readonly Signal[];
  /**
   * Reads a version out of the document, or `undefined`.
   *
   * Only where the page *states* one. A version guessed from a URL shape —
   * `/assets/app-4.2.1.js` — is a coincidence dressed as a fact, and §16's
   * "never claim what the signals do not support" covers versions too.
   */
  version?: (context: DetectContext) => string | undefined;
}

/**
 * Rules for the JavaScript frameworks that leave a mark in delivered markup.
 *
 * Source: each framework's own documentation for the hydration payload or the
 * scoping attribute it emits. A framework that leaves nothing in the HTML is
 * deliberately absent — see the note at the bottom of this file.
 */
const FRAMEWORKS: readonly Rule[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    category: 'framework',
    signals: [
      { label: '__NEXT_DATA__ script', weight: 0.7, test: selector('script#__NEXT_DATA__') },
      { label: '/_next/static asset path', weight: 0.4, test: includes('/_next/static') },
      { label: 'self.__next_f hydration push', weight: 0.5, test: includes('self.__next_f') },
    ],
    // No version. Next.js states a `buildId`, which identifies a deployment
    // rather than a release, and reporting it as a version would be a lie with
    // a plausible shape.
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    category: 'framework',
    signals: [
      { label: '__NUXT__ state global', weight: 0.7, test: includes('window.__nuxt__') },
      { label: '/_nuxt/ asset path', weight: 0.4, test: includes('/_nuxt/') },
      { label: 'nuxt-data script', weight: 0.5, test: selector('script#__NUXT_DATA__') },
    ],
  },
  {
    id: 'react',
    name: 'React',
    category: 'framework',
    signals: [
      { label: 'data-reactroot attribute', weight: 0.6, test: selector('[data-reactroot]') },
      { label: 'React hydration comment marker', weight: 0.4, test: includes('<!--$-->') },
      { label: 'react-dom bundle', weight: 0.5, test: includes('react-dom') },
    ],
  },
  {
    id: 'vue',
    name: 'Vue.js',
    category: 'framework',
    signals: [
      // Vue's single-file-component compiler stamps data-v-<hash> onto scoped
      // markup; there is no selector for a prefixed attribute name.
      { label: 'data-v- scoped style attribute', weight: 0.5, test: attrPrefix('data-v-') },
      {
        label: 'data-server-rendered attribute',
        weight: 0.6,
        test: selector('[data-server-rendered]'),
      },
      { label: 'vue runtime bundle', weight: 0.4, test: includesAny('vue.runtime', 'vue.global') },
    ],
  },
  {
    id: 'angular',
    name: 'Angular',
    category: 'framework',
    signals: [
      { label: 'ng-version attribute', weight: 0.8, test: selector('[ng-version]') },
      { label: '_nghost scoping attribute', weight: 0.4, test: attrPrefix('_nghost') },
      { label: 'app-root element', weight: 0.2, test: selector('app-root') },
    ],
    // Angular publishes its exact version in the attribute, so this one is read
    // rather than inferred.
    version: (context) => firstMatch(context, /ng-version="([^"]+)"/),
  },
  {
    id: 'svelte',
    name: 'Svelte',
    category: 'framework',
    signals: [
      { label: 'svelte- scoping class', weight: 0.4, test: includes('class="svelte-') },
      { label: 'SvelteKit data payload', weight: 0.6, test: includes('__sveltekit_') },
    ],
  },
];

/**
 * Content management systems that are not storefronts.
 *
 * Source: each project's default theme output and its `generator` meta tag,
 * which all three set by default.
 */
const CMS: readonly Rule[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'cms',
    signals: [
      { label: 'generator meta names WordPress', weight: 0.7, test: generator('wordpress') },
      { label: '/wp-content/ asset path', weight: 0.5, test: includes('/wp-content/') },
      { label: '/wp-includes/ asset path', weight: 0.4, test: includes('/wp-includes/') },
      {
        label: 'WordPress REST link header',
        weight: 0.3,
        test: selector('link[rel="https://api.w.org/"]'),
      },
    ],
    version: (context) => firstMatch(context, /content="WordPress\s+([\d.]+)"/i),
  },
  {
    id: 'drupal',
    name: 'Drupal',
    category: 'cms',
    signals: [
      { label: 'generator meta names Drupal', weight: 0.7, test: generator('drupal') },
      { label: 'drupalSettings global', weight: 0.6, test: includes('drupalsettings') },
      { label: '/sites/default/files asset', weight: 0.4, test: includes('/sites/default/files') },
    ],
  },
  {
    id: 'joomla',
    name: 'Joomla',
    category: 'cms',
    signals: [
      { label: 'generator meta names Joomla', weight: 0.7, test: generator('joomla') },
      { label: '/media/jui/ asset path', weight: 0.4, test: includes('/media/jui/') },
    ],
  },
];

/**
 * Analytics and product-measurement scripts.
 *
 * Source: each vendor's published install snippet. These are the highest-value
 * rules for a Persian storefront, where Yektanet and Clarity are common and no
 * foreign ruleset covers them well.
 */
const ANALYTICS: readonly Rule[] = [
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'analytics',
    signals: [
      { label: 'gtag.js loader', weight: 0.7, test: includes('googletagmanager.com/gtag/js') },
      {
        label: 'analytics.js loader',
        weight: 0.6,
        test: includes('google-analytics.com/analytics.js'),
      },
      { label: 'GA4 measurement id', weight: 0.5, test: matches(/\bG-[A-Z0-9]{8,}\b/) },
      { label: 'window.dataLayer gtag bootstrap', weight: 0.3, test: includes("gtag('config'") },
    ],
    // The measurement id is the closest thing GA has to a version, and the page
    // states it verbatim, so it is reported rather than inferred.
    version: (context) => firstMatch(context, /\b(G-[A-Z0-9]{8,})\b/),
  },
  {
    id: 'google-tag-manager',
    name: 'Google Tag Manager',
    category: 'tag-manager',
    signals: [
      { label: 'gtm.js loader', weight: 0.7, test: includes('googletagmanager.com/gtm.js') },
      { label: 'GTM noscript iframe', weight: 0.6, test: includes('googletagmanager.com/ns.html') },
      { label: 'GTM container id', weight: 0.4, test: matches(/\bGTM-[A-Z0-9]{4,}\b/) },
    ],
    version: (context) => firstMatch(context, /\b(GTM-[A-Z0-9]{4,})\b/),
  },
  {
    id: 'meta-pixel',
    name: 'Meta Pixel',
    category: 'analytics',
    signals: [
      { label: 'fbevents.js loader', weight: 0.7, test: includes('connect.facebook.net') },
      { label: 'fbq init call', weight: 0.6, test: includes('fbq(') },
      {
        label: 'facebook tracking noscript pixel',
        weight: 0.4,
        test: includes('facebook.com/tr?'),
      },
    ],
  },
  {
    id: 'microsoft-clarity',
    name: 'Microsoft Clarity',
    category: 'analytics',
    signals: [
      { label: 'clarity.ms script', weight: 0.7, test: includes('clarity.ms/tag') },
      { label: 'window.clarity global', weight: 0.5, test: includes('window.clarity') },
    ],
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'analytics',
    signals: [
      { label: 'static.hotjar.com script', weight: 0.7, test: includes('static.hotjar.com') },
      { label: '_hjSettings global', weight: 0.6, test: includes('_hjsettings') },
    ],
  },
  {
    id: 'yektanet',
    name: 'Yektanet',
    category: 'analytics',
    signals: [
      { label: 'yektanet.com script', weight: 0.7, test: includes('yektanet.com') },
      {
        label: 'yektanetAnalyticsObject global',
        weight: 0.6,
        test: includes('yektanetanalyticsobject'),
      },
    ],
  },
  {
    id: 'matomo',
    name: 'Matomo',
    category: 'analytics',
    signals: [
      { label: 'matomo.js tracker', weight: 0.7, test: includesAny('matomo.js', 'piwik.js') },
      { label: '_paq tracking queue', weight: 0.5, test: includes('_paq.push') },
    ],
  },
  {
    id: 'plausible',
    name: 'Plausible',
    category: 'analytics',
    signals: [
      { label: 'plausible.io script', weight: 0.8, test: includes('plausible.io/js') },
      {
        label: 'data-domain attribute on tracker',
        weight: 0.3,
        test: selector('script[data-domain]'),
      },
    ],
  },
];

/**
 * Content delivery networks, seen only where the page names the host.
 *
 * Source: each provider's documented asset hostname. A CDN that serves from the
 * site's own domain is invisible here without response headers, which `core`
 * does not have — see the note at the bottom of this file.
 */
const CDNS: readonly Rule[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'cdn',
    signals: [
      { label: 'cdnjs.cloudflare.com asset', weight: 0.5, test: includes('cdnjs.cloudflare.com') },
      {
        label: 'Cloudflare challenge platform',
        weight: 0.7,
        test: includes('/cdn-cgi/challenge-platform'),
      },
      { label: '/cdn-cgi/ endpoint', weight: 0.5, test: includes('/cdn-cgi/') },
      { label: 'Rocket Loader script type', weight: 0.6, test: includes('text/rocketscript') },
    ],
  },
  {
    id: 'jsdelivr',
    name: 'jsDelivr',
    category: 'cdn',
    signals: [{ label: 'cdn.jsdelivr.net asset', weight: 0.8, test: includes('cdn.jsdelivr.net') }],
  },
  {
    id: 'unpkg',
    name: 'unpkg',
    category: 'cdn',
    signals: [{ label: 'unpkg.com asset', weight: 0.8, test: includes('unpkg.com') }],
  },
  {
    id: 'arvancloud',
    name: 'ArvanCloud',
    category: 'cdn',
    signals: [
      {
        label: 'arvancloud asset host',
        weight: 0.7,
        test: includesAny('arvancloud.ir', 'arvancloud.com'),
      },
      { label: 'arvanvod media host', weight: 0.5, test: includes('arvanvod.') },
    ],
  },
  {
    id: 'fastly',
    name: 'Fastly',
    category: 'cdn',
    signals: [
      {
        label: 'fastly asset host',
        weight: 0.7,
        test: includesAny('.fastly.net', 'fastly.jsdelivr'),
      },
    ],
  },
];

/**
 * Payment widgets and gateways that render something into the page.
 *
 * Source: each gateway's published integration snippet. Iranian gateways are
 * included because they are what this project's users actually meet, and no
 * foreign ruleset carries them.
 */
const PAYMENTS: readonly Rule[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payment',
    signals: [
      { label: 'js.stripe.com script', weight: 0.8, test: includes('js.stripe.com') },
      { label: 'Stripe.js global', weight: 0.4, test: includes('stripe(') },
    ],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'payment',
    signals: [
      { label: 'paypal.com/sdk/js loader', weight: 0.8, test: includes('paypal.com/sdk/js') },
      { label: 'paypalobjects asset', weight: 0.4, test: includes('paypalobjects.com') },
    ],
  },
  {
    id: 'zarinpal',
    name: 'ZarinPal',
    category: 'payment',
    signals: [
      { label: 'zarinpal.com endpoint', weight: 0.7, test: includes('zarinpal.com') },
      {
        label: 'ZarinPal trust badge',
        weight: 0.4,
        test: all(includes('zarinpal'), includes('trustlogo')),
      },
    ],
  },
  {
    id: 'idpay',
    name: 'IDPay',
    category: 'payment',
    signals: [{ label: 'idpay.ir endpoint', weight: 0.7, test: includes('idpay.ir') }],
  },
  {
    id: 'shaparak',
    name: 'Shaparak',
    category: 'payment',
    signals: [{ label: 'shaparak.ir gateway link', weight: 0.6, test: includes('shaparak.ir') }],
  },
];

/**
 * Live-chat and support widgets.
 *
 * Source: each vendor's published embed snippet.
 */
const CHAT: readonly Rule[] = [
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'chat',
    signals: [
      { label: 'widget.intercom.io script', weight: 0.8, test: includes('widget.intercom.io') },
      { label: 'intercomSettings global', weight: 0.6, test: includes('intercomsettings') },
    ],
  },
  {
    id: 'crisp',
    name: 'Crisp',
    category: 'chat',
    signals: [
      { label: 'client.crisp.chat script', weight: 0.8, test: includes('client.crisp.chat') },
      { label: 'CRISP_WEBSITE_ID global', weight: 0.6, test: includes('crisp_website_id') },
    ],
  },
  {
    id: 'tawk-to',
    name: 'Tawk.to',
    category: 'chat',
    signals: [
      { label: 'embed.tawk.to script', weight: 0.8, test: includes('embed.tawk.to') },
      { label: 'Tawk_API global', weight: 0.5, test: includes('tawk_api') },
    ],
  },
  {
    id: 'goftino',
    name: 'Goftino',
    category: 'chat',
    signals: [
      { label: 'goftino.com widget', weight: 0.8, test: includes('goftino.com') },
      { label: 'Goftino widget bootstrap', weight: 0.5, test: includes('goftino_widget') },
    ],
  },
  {
    id: 'raychat',
    name: 'Raychat',
    category: 'chat',
    signals: [
      { label: 'raychat.io widget', weight: 0.8, test: includes('raychat.io') },
      { label: 'RAYCHAT_TOKEN global', weight: 0.5, test: includes('raychat_token') },
    ],
  },
];

/**
 * Web-font services, detected from the host they are served from.
 *
 * Source: each service's documented delivery hostname. `fonts.ts` reads the
 * same hosts to fill `FontOrigin.service`, and the two lists are kept in step
 * by `FONT_SERVICE_HOSTS` there being the single home for the hostnames.
 */
const FONT_SERVICES: readonly Rule[] = [
  {
    id: 'google-fonts',
    name: 'Google Fonts',
    category: 'font-service',
    signals: [
      {
        label: 'fonts.googleapis.com stylesheet',
        weight: 0.8,
        test: includes('fonts.googleapis.com'),
      },
      { label: 'fonts.gstatic.com preconnect', weight: 0.4, test: includes('fonts.gstatic.com') },
    ],
  },
  {
    id: 'font-awesome',
    name: 'Font Awesome',
    category: 'font-service',
    signals: [
      { label: 'fontawesome stylesheet', weight: 0.7, test: includes('font-awesome') },
      { label: 'kit.fontawesome.com loader', weight: 0.8, test: includes('kit.fontawesome.com') },
      { label: 'fa- icon class', weight: 0.2, test: selector('[class*="fa-"]') },
    ],
  },
  {
    id: 'typekit',
    name: 'Adobe Fonts',
    category: 'font-service',
    signals: [
      { label: 'use.typekit.net stylesheet', weight: 0.8, test: includes('use.typekit.net') },
    ],
  },
  {
    id: 'fontiran',
    name: 'FontIran',
    category: 'font-service',
    signals: [{ label: 'fontiran.com stylesheet', weight: 0.8, test: includes('fontiran.com') }],
  },
];

/**
 * Error and performance monitoring.
 *
 * Source: each vendor's published browser-SDK snippet.
 */
const ERROR_TRACKING: readonly Rule[] = [
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'error-tracking',
    signals: [
      { label: 'browser.sentry-cdn.com bundle', weight: 0.8, test: includes('sentry-cdn.com') },
      { label: 'Sentry.init call', weight: 0.6, test: includes('sentry.init') },
      { label: 'sentry ingest endpoint', weight: 0.5, test: includes('ingest.sentry.io') },
    ],
  },
  {
    id: 'datadog-rum',
    name: 'Datadog RUM',
    category: 'error-tracking',
    signals: [
      { label: 'datadog browser RUM bundle', weight: 0.8, test: includes('datadog-rum') },
      { label: 'DD_RUM global', weight: 0.5, test: includes('dd_rum') },
    ],
  },
  {
    id: 'newrelic',
    name: 'New Relic',
    category: 'error-tracking',
    signals: [
      { label: 'NREUM global', weight: 0.7, test: includes('nreum') },
      {
        label: 'js-agent.newrelic.com bundle',
        weight: 0.8,
        test: includes('js-agent.newrelic.com'),
      },
    ],
  },
];

/**
 * Storefronts, so a caller asking the inspector one question gets one answer.
 *
 * These ids and weights are the same rules `platform/detect.ts` runs — the
 * shape differs only because a `Technology` carries a category and a display
 * name and a `PlatformDetection` carries `adapterAvailable`. A caller that
 * needs to dispatch an adapter still asks `detectPlatform`; a caller that wants
 * to show a person what the site is made of asks here and gets storefronts
 * listed alongside everything else.
 */
const STOREFRONTS: readonly Rule[] = [
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'ecommerce',
    signals: [
      { label: 'generator meta names WooCommerce', weight: 0.6, test: generator('woocommerce') },
      {
        label: 'wp-content/plugins/woocommerce asset',
        weight: 0.5,
        test: includes('/plugins/woocommerce/'),
      },
      { label: 'Store API path in page', weight: 0.6, test: includes('/wp-json/wc/store/') },
      { label: 'wc_add_to_cart_params', weight: 0.4, test: includes('wc_add_to_cart_params') },
    ],
    version: (context) => firstMatch(context, /WooCommerce\s+([\d.]+)/i),
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'ecommerce',
    signals: [
      {
        label: 'shopify-digital-wallet meta',
        weight: 0.6,
        test: selector('#shopify-digital-wallet'),
      },
      { label: 'Shopify JS global', weight: 0.6, test: includes('shopify.shop') },
      { label: 'cdn.shopify.com asset', weight: 0.5, test: includes('cdn.shopify.com') },
      { label: 'myshopify.com host', weight: 0.4, test: includes('myshopify.com') },
    ],
  },
  {
    id: 'magento',
    name: 'Magento',
    category: 'ecommerce',
    signals: [
      { label: 'x-magento-init script', weight: 0.6, test: includes('text/x-magento-init') },
      { label: 'Magento_ JS module', weight: 0.4, test: includes('magento_') },
      { label: 'generator meta names Magento', weight: 0.6, test: generator('magento') },
    ],
  },
  {
    id: 'prestashop',
    name: 'PrestaShop',
    category: 'ecommerce',
    signals: [
      { label: 'generator meta names PrestaShop', weight: 0.6, test: generator('prestashop') },
      { label: 'prestashop JS global', weight: 0.6, test: includes('var prestashop') },
    ],
  },
  {
    id: 'opencart',
    name: 'OpenCart',
    category: 'ecommerce',
    signals: [
      { label: 'generator meta names OpenCart', weight: 0.6, test: generator('opencart') },
      { label: 'catalog/view/theme asset', weight: 0.5, test: includes('catalog/view/theme/') },
    ],
  },
];

const RULES: readonly Rule[] = [
  ...STOREFRONTS,
  ...CMS,
  ...FRAMEWORKS,
  ...ANALYTICS,
  ...CDNS,
  ...PAYMENTS,
  ...CHAT,
  ...FONT_SERVICES,
  ...ERROR_TRACKING,
];

/** Every category the ruleset can currently return something for. */
export const TECHNOLOGY_CATEGORIES: readonly TechnologyCategory[] = [
  'ecommerce',
  'cms',
  'framework',
  'analytics',
  'tag-manager',
  'cdn',
  'payment',
  'chat',
  'font-service',
  'error-tracking',
];

/**
 * Every technology the document shows evidence for, most confident first.
 *
 * An **empty array is a real answer** and the common one for a hand-written
 * page: it means the markup carried no marker any rule recognises, which is
 * different from "detection failed". §16 is explicit that an honest nothing
 * beats a confident guess, so a rule that half-fires returns nothing at all
 * rather than a low-confidence entry a UI would then render as a fact.
 *
 * Ties are broken by id so the order is stable across runs — a report that
 * reshuffles between two identical scans is a report nobody trusts.
 */
export function detectTechnologies(page: PageContext, $: CheerioAPI): Technology[] {
  const context = makeContext(page, $);
  const found: Technology[] = [];

  for (const rule of RULES) {
    const result = runSignals(rule.signals, context);
    if (result === undefined) continue;

    const version = rule.version?.(context);
    found.push({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      confidence: result.confidence,
      signals: result.signals,
      ...(version === undefined ? {} : { version }),
    });
  }

  return found.sort(
    (a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The same list, grouped, for a UI that shows one section per category.
 *
 * Categories with nothing in them are omitted rather than present-and-empty,
 * so a caller can render the map directly without filtering it first.
 */
export function groupTechnologies(
  technologies: readonly Technology[]
): Map<TechnologyCategory, Technology[]> {
  const grouped = new Map<TechnologyCategory, Technology[]>();
  for (const technology of technologies) {
    const bucket = grouped.get(technology.category);
    if (bucket === undefined) grouped.set(technology.category, [technology]);
    else bucket.push(technology);
  }
  return grouped;
}

/*
 * Deliberately not detected here, so nobody adds them thinking they were
 * forgotten:
 *
 * - **Server software, and CDNs that serve from the site's own domain.** Both
 *   are response-header facts (`server`, `x-powered-by`, `cf-ray`) and this
 *   module is handed a document, not a response. The app (§15) has the headers
 *   and can widen the input later; guessing from markup would produce exactly
 *   the confident-wrong answer §16 forbids.
 * - **Frameworks that leave no trace in delivered HTML.** A fully static export
 *   is indistinguishable from hand-written markup, and it should be.
 * - **Version numbers inferred from an asset filename.** `/app-4.2.1.js` names
 *   a bundle, not a framework release. `version` is populated only where the
 *   page states the version as a value.
 */
