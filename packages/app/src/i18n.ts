/**
 * Persian and English, with real RTL — CLAUDE.md §18.
 *
 * A plain record per language rather than an i18n library. The app has one
 * screenful of strings, no pluralisation rules worth the name, and §15's "no
 * account, no server" means nothing is ever loaded at runtime — so a library
 * would be a dependency and a bundle cost buying almost nothing. If the string
 * count grows past what one file can hold, that is the moment to revisit, not
 * before.
 *
 * The two catalogues are typed against each other, so adding an English string
 * without its Persian counterpart is a compile error rather than a blank label
 * discovered by a Persian-speaking user.
 */

export type Language = 'en' | 'fa';

const en = {
  brand: 'proc123',
  navScan: 'Scan',
  navInspect: 'Inspect',
  navSettings: 'Settings',

  scanTitle: 'Scan a category',
  urlLabel: 'Category or collection URL',
  urlPlaceholder: 'https://shop.example/product-category/nuts/',
  startScan: 'Scan',
  scanning: 'Scanning…',
  scanFailed: 'The scan did not finish',
  noResults: 'Nothing scanned yet. Paste a category URL and press Scan.',
  politeNote:
    'Requests are paced so as not to burden the shop. A large catalogue takes a few minutes.',
  rendering: 'The markup listed no products, so the page is being opened in a browser…',
  readVia: 'Read via',
  readStatic: 'page markup',
  readRendered: 'a rendered browser page',
  markupSize: 'Markup',
  renderAddedNothing:
    'Rendering returned the same markup the fetch did, so this page is not waiting on JavaScript — whatever is missing is missing for another reason.',
  resultsTitle: 'Scan result',
  products: 'products',
  rows: 'CSV rows',
  variations: 'variations',
  readFrom: 'Read from',
  pages: 'Pages',

  colType: 'Type',
  colName: 'Name',
  colSku: 'SKU',
  colRegular: 'Regular price',
  colSale: 'Sale price',
  colStock: 'In stock',
  colCategories: 'Categories',

  yes: 'Yes',
  no: 'No',

  currencyTitle: 'Confirm the price unit before exporting',
  currencyWhy:
    'The shop quoted these prices in rial or in toman and did not say which. Getting it wrong multiplies every price by ten, in the shop you import into.',
  currencyToman: 'Toman',
  currencyRial: 'Rial',
  currencyExample: 'The first product would be',
  currencyConfirmed: 'Unit confirmed',
  currencyPending: 'Not yet confirmed',
  export: 'Export CSV',
  exportBlocked: 'Confirm the price unit first',

  saving: 'Saving…',
  saved: 'Saved to',
  saveCancelled: 'Not saved.',

  settingsTitle: 'Settings',
  language: 'Language',
  theme: 'Theme',
  themeSystem: 'Follow the system',
  themeLight: 'Light',
  themeDark: 'Dark',
  host: 'Running on',

  settingsScanning: 'Scanning',
  exporter: 'Export format',
  contentMode: 'Descriptions',
  contentStructured: 'Leave empty (recommended)',
  contentReference: 'Copy, tagged with the source URL',
  contentRewrite: 'Rewrite with AI',
  maxPages: 'Maximum pages',
  delayMs: 'Delay between requests (ms)',
  maxConcurrent: 'Requests at once',
  politeWarning: 'A short delay puts more load on the shop you are reading.',
  contentWarning: 'Descriptions are the shop’s content, not yours.',
  displayUnit: 'IRR prices are usually in',
  displayUnitNote:
    'A starting point only. Every export still asks, because the shop is what decides.',

  navAbout: 'About',
  aboutTitle: 'About proc123',
  aboutWhat:
    'Reads a category page from a shop and writes a CSV another shop can import. WooCommerce, Shopify, or plain JSON.',
  aboutPrivacyTitle: 'No account, no server, no telemetry',
  aboutPrivacy:
    'There is no sign-up and nothing owned by this project to sign in to. The only requests this app makes are to the shop you point it at — and, if you switch on the AI fallback with your own key, to your own provider. Nothing else leaves this machine.',
  aboutLimitsTitle: 'What it will not do',
  aboutLimits:
    'It does not solve CAPTCHAs, spoof fingerprints, rotate proxies, or retry past a block. When a shop signals that it does not want to be read automatically, the scan stops and says so.',
  aboutLicence: 'MIT licensed. Source and issues:',
  version: 'Version',

  inspectTitle: 'Inspect a page',
  inspectSoon:
    'The inspector reads a page the app has fetched. Fetching arrives in the next phase, so this view is waiting on it.',
} as const;

/** Every key `en` has, so a missing translation cannot ship. */
type Catalogue = Record<keyof typeof en, string>;

const fa: Catalogue = {
  brand: 'proc123',
  navScan: 'اسکن',
  navInspect: 'بررسی صفحه',
  navSettings: 'تنظیمات',

  scanTitle: 'اسکن یک دسته‌بندی',
  urlLabel: 'نشانی دسته‌بندی',
  urlPlaceholder: 'https://shop.example/product-category/nuts/',
  startScan: 'اسکن',
  scanning: 'در حال اسکن…',
  scanFailed: 'اسکن کامل نشد',
  noResults: 'هنوز چیزی اسکن نشده. نشانی یک دسته‌بندی را بگذارید و اسکن را بزنید.',
  politeNote:
    'درخواست‌ها با فاصله فرستاده می‌شوند تا به فروشگاه فشار نیاید. یک فهرست بزرگ چند دقیقه طول می‌کشد.',
  rendering: 'در نشانه‌گذاری صفحه محصولی نبود، پس صفحه در یک مرورگر باز می‌شود…',
  readVia: 'خوانده‌شده از',
  readStatic: 'نشانه‌گذاری صفحه',
  readRendered: 'صفحهٔ رندرشده در مرورگر',
  markupSize: 'حجم نشانه‌گذاری',
  renderAddedNothing:
    'رندر همان نشانه‌گذاری‌ای را برگرداند که دریافت ساده برگردانده بود، پس این صفحه منتظر جاوااسکریپت نیست — هرچه کم است، به دلیل دیگری کم است.',
  resultsTitle: 'نتیجهٔ اسکن',
  products: 'محصول',
  rows: 'سطر CSV',
  variations: 'تنوع',
  readFrom: 'خوانده‌شده از',
  pages: 'صفحه',

  colType: 'نوع',
  colName: 'نام',
  colSku: 'شناسهٔ کالا',
  colRegular: 'قیمت عادی',
  colSale: 'قیمت فروش',
  colStock: 'موجود',
  colCategories: 'دسته‌بندی',

  yes: 'بله',
  no: 'خیر',

  currencyTitle: 'قبل از خروجی گرفتن، واحد قیمت را تأیید کنید',
  currencyWhy:
    'فروشگاه این قیمت‌ها را به ریال یا تومان نوشته و مشخص نکرده کدام. اشتباه گرفتن این دو، همهٔ قیمت‌ها را در فروشگاه مقصد ده برابر می‌کند.',
  currencyToman: 'تومان',
  currencyRial: 'ریال',
  currencyExample: 'اولین محصول می‌شود',
  currencyConfirmed: 'واحد تأیید شد',
  currencyPending: 'هنوز تأیید نشده',
  export: 'خروجی CSV',
  exportBlocked: 'اول واحد قیمت را تأیید کنید',

  saving: 'در حال ذخیره…',
  saved: 'ذخیره شد در',
  saveCancelled: 'ذخیره نشد.',

  settingsTitle: 'تنظیمات',
  language: 'زبان',
  theme: 'پوسته',
  themeSystem: 'مطابق سیستم',
  themeLight: 'روشن',
  themeDark: 'تیره',
  host: 'در حال اجرا روی',

  settingsScanning: 'اسکن',
  exporter: 'قالب خروجی',
  contentMode: 'توضیحات',
  contentStructured: 'خالی بگذار (پیشنهادی)',
  contentReference: 'کپی کن، با نشانی منبع',
  contentRewrite: 'با هوش مصنوعی بازنویسی کن',
  maxPages: 'بیشترین تعداد صفحه',
  delayMs: 'فاصلهٔ بین درخواست‌ها (میلی‌ثانیه)',
  maxConcurrent: 'درخواست هم‌زمان',
  politeWarning: 'فاصلهٔ کم، بار بیشتری روی فروشگاهی می‌گذارد که می‌خوانید.',
  contentWarning: 'توضیحات محتوای فروشگاه است، نه شما.',
  displayUnit: 'قیمت‌های ریالی معمولاً به',
  displayUnitNote: 'فقط نقطهٔ شروع. هر خروجی باز هم می‌پرسد، چون فروشگاه است که تعیین می‌کند.',

  navAbout: 'درباره',
  aboutTitle: 'دربارهٔ proc123',
  aboutWhat:
    'صفحهٔ دسته‌بندی یک فروشگاه را می‌خواند و CSV می‌نویسد که فروشگاه دیگری بتواند وارد کند. WooCommerce، Shopify، یا JSON ساده.',
  aboutPrivacyTitle: 'بدون حساب، بدون سرور، بدون تله‌متری',
  aboutPrivacy:
    'ثبت‌نامی وجود ندارد و چیزی متعلق به این پروژه نیست که واردش شوید. تنها درخواست‌هایی که این برنامه می‌فرستد به فروشگاهی است که نشانش می‌دهید — و اگر لایهٔ هوش مصنوعی را با کلید خودتان روشن کنید، به ارائه‌دهندهٔ خودتان. چیز دیگری از این دستگاه بیرون نمی‌رود.',
  aboutLimitsTitle: 'کاری که نمی‌کند',
  aboutLimits:
    'کپچا حل نمی‌کند، اثر انگشت جعل نمی‌کند، پروکسی نمی‌چرخاند، و بعد از بلاک دوباره تلاش نمی‌کند. وقتی فروشگاهی علامت می‌دهد که نمی‌خواهد خودکار خوانده شود، اسکن می‌ایستد و می‌گوید.',
  aboutLicence: 'با پروانهٔ MIT. کد و مشکلات:',
  version: 'نسخه',

  inspectTitle: 'بررسی صفحه',
  inspectSoon:
    'بازرس صفحه‌ای را می‌خواند که برنامه دریافت کرده باشد. دریافت در فاز بعد می‌آید، پس این نما منتظر آن است.',
};

const CATALOGUES: Record<Language, Catalogue> = { en, fa };

export type MessageKey = keyof typeof en;

/** Which way each language runs. The only place this is decided. */
export function directionOf(language: Language): 'ltr' | 'rtl' {
  return language === 'fa' ? 'rtl' : 'ltr';
}

export function translate(language: Language, key: MessageKey): string {
  return CATALOGUES[language][key];
}

/**
 * Persian digits for display, and **only** for display.
 *
 * §7.8 is emphatic in the other direction: the data stays ASCII-normalised all
 * the way to the CSV, because a Persian numeral in a price column is a number
 * no importer will read. So this is applied when writing text into the DOM and
 * never to a value that will be exported — which is why it lives here, beside
 * the language, rather than anywhere near the model.
 */
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function localiseDigits(text: string, language: Language): string {
  if (language !== 'fa') return text;
  return text.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

/**
 * A number with thousands separators, in the reader's digits.
 *
 * Grouping is what makes a ten-times error visible to a person: `۴۲۰٬۰۰۰` and
 * `۴٬۲۰۰٬۰۰۰` are told apart at a glance in a way that two unbroken runs of
 * digits are not. Given §7.8, that is worth doing carefully.
 */
export function formatAmount(amount: number, language: Language): string {
  const grouped = new Intl.NumberFormat('en-US').format(amount);
  return localiseDigits(grouped, language);
}
