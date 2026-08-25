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

  resultsTitle: 'Scan result',
  resultsFixtureNote:
    'This is a saved example. The app cannot fetch anything yet — that arrives in the next phase.',
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

  settingsTitle: 'Settings',
  language: 'Language',
  theme: 'Theme',
  themeSystem: 'Follow the system',
  themeLight: 'Light',
  themeDark: 'Dark',
  host: 'Running on',

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

  resultsTitle: 'نتیجهٔ اسکن',
  resultsFixtureNote:
    'این یک نمونهٔ ذخیره‌شده است. برنامه هنوز نمی‌تواند چیزی دریافت کند — آن در فاز بعد می‌آید.',
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

  settingsTitle: 'تنظیمات',
  language: 'زبان',
  theme: 'پوسته',
  themeSystem: 'مطابق سیستم',
  themeLight: 'روشن',
  themeDark: 'تیره',
  host: 'در حال اجرا روی',

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
