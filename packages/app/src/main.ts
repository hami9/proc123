/**
 * The app's front end.
 *
 * Vanilla TypeScript and small render functions, the same idiom the popup uses.
 * One language across three surfaces means a person who has read `popup.ts` can
 * read this, and the app's reactive surface — a result table, a settings pane,
 * a confirmation step — does not need a framework to hold it. If that stops
 * being true, that is a reason to revisit, and a better one than adopting a
 * framework because the file was new.
 *
 * Nothing here decides anything. The currency rule is `currency.ts`, the
 * product model is `core`, and the strings are `i18n.ts`. This file is
 * arrangement.
 */

import type { CanonicalProduct, CurrencyUnit } from '@proc123/core';

import { canExport, currencyQuestion, readingsOf } from './currency.js';
import { FIXTURE_PRODUCTS, FIXTURE_SUMMARY } from './fixture.js';
import {
  type Language,
  type MessageKey,
  directionOf,
  formatAmount,
  localiseDigits,
  translate,
} from './i18n.js';

type Route = 'scan' | 'inspect' | 'settings';
type Theme = 'system' | 'light' | 'dark';

interface State {
  language: Language;
  theme: Theme;
  route: Route;
  /** `undefined` until the user answers. Never defaulted — see `currency.ts`. */
  currencyAnswer: CurrencyUnit | undefined;
  products: CanonicalProduct[];
}

const state: State = {
  language: 'en',
  theme: 'system',
  route: 'scan',
  currencyAnswer: undefined,
  products: FIXTURE_PRODUCTS,
};

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
};

const t = (key: MessageKey): string => translate(state.language, key);
/** Numbers in the reader's digits. Display only — §7.8. */
const n = (value: number | string): string => localiseDigits(String(value), state.language);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ chrome */

/**
 * Language decides both the strings and the direction, and they are set
 * together on the root so no view has to remember to.
 */
function applyLanguage(): void {
  const root = document.documentElement;
  root.lang = state.language;
  root.dir = directionOf(state.language);

  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset['i18n'] as MessageKey | undefined;
    if (key !== undefined) node.textContent = translate(state.language, key);
  }
}

/**
 * `system` removes the override and lets the stylesheet's
 * `prefers-color-scheme` answer, which is §18's default.
 */
function applyTheme(): void {
  const root = document.documentElement;
  if (state.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.theme);
  root.style.colorScheme = state.theme === 'system' ? 'light dark' : state.theme;
}

function showRoute(): void {
  for (const view of ['scan', 'inspect', 'settings'] as const) {
    element(`view-${view}`).hidden = view !== state.route;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route]')) {
    const route = button.dataset['route'];
    if (route === state.route) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

/* -------------------------------------------------------------- scan view */

function summaryLine(): HTMLElement {
  const products = state.products.filter((product) => product.kind !== 'variation').length;
  const variations = state.products.filter((product) => product.kind === 'variation').length;

  const card = el('div', 'card stack');
  card.append(el('h1', undefined, t('resultsTitle')));

  const counts = el('div', 'row');
  counts.append(
    el('strong', undefined, `${n(products)} ${t('products')}`),
    el('span', 'badge', `${n(state.products.length)} ${t('rows')}`),
    el('span', 'badge', `${n(variations)} ${t('variations')}`),
    el('span', 'badge', `${t('readFrom')}: ${FIXTURE_SUMMARY.platform}`),
    el('span', 'badge', `${t('pages')}: ${n(FIXTURE_SUMMARY.pagesScanned)}`)
  );
  card.append(counts);
  card.append(el('p', 'muted small', t('resultsFixtureNote')));
  return card;
}

/**
 * The confirmation, rendered only when there is something to confirm.
 *
 * Each choice shows what the first price *becomes* under that reading, because
 * that is the difference a person can actually check against the shop they were
 * just looking at.
 */
function currencyCard(): HTMLElement | undefined {
  const question = currencyQuestion(state.products);
  if (!question.needed) return undefined;

  const card = el('section', 'currency stack');
  card.append(el('h2', undefined, t('currencyTitle')));
  card.append(el('p', 'small', t('currencyWhy')));

  const choices = el('div', 'choices');
  const readings = question.sample === undefined ? undefined : readingsOf(question.sample);

  for (const unit of ['toman', 'rial'] as const) {
    const button = el('button', 'choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', state.currencyAnswer === unit ? 'true' : 'false');
    button.append(document.createTextNode(t(unit === 'toman' ? 'currencyToman' : 'currencyRial')));

    if (readings !== undefined) {
      const example = el('span', 'example');
      example.textContent =
        `${t('currencyExample')} ` +
        `${formatAmount(readings[unit], state.language)} ${t('currencyToman')}`;
      button.append(example);
    }

    button.addEventListener('click', () => {
      state.currencyAnswer = unit;
      renderScan();
    });
    choices.append(button);
  }

  card.append(choices);
  return card;
}

function priceCell(product: CanonicalProduct, which: 'regularPrice' | 'salePrice'): string {
  const price = product[which];
  if (price === undefined) return '';
  return formatAmount(price.amount, state.language);
}

function productTable(): HTMLElement {
  const wrap = el('div', 'table-wrap');
  const table = el('table');

  const head = el('thead');
  const headRow = el('tr');
  for (const key of [
    'colType',
    'colName',
    'colSku',
    'colRegular',
    'colSale',
    'colStock',
    'colCategories',
  ] as const) {
    headRow.append(el('th', undefined, t(key)));
  }
  head.append(headRow);
  table.append(head);

  const body = el('tbody');
  for (const product of state.products) {
    const row = el('tr');
    const isVariation = product.kind === 'variation';

    row.append(el('td', undefined, product.kind));

    // Variations are indented, because §7.4 puts them directly under their
    // parent and the indent is what makes that visible at a glance.
    const name = el('td', isVariation ? 'variation' : undefined);
    const axis = product.attributes.find((attribute) => attribute.isVariationAxis);
    name.textContent =
      isVariation && axis !== undefined
        ? `${product.name} — ${axis.values.join(', ')}`
        : product.name;
    row.append(name);

    row.append(el('td', undefined, product.sku ?? ''));
    row.append(el('td', 'numeral', priceCell(product, 'regularPrice')));
    row.append(el('td', 'numeral', priceCell(product, 'salePrice')));
    row.append(
      el('td', undefined, product.inStock === undefined ? '' : t(product.inStock ? 'yes' : 'no'))
    );
    row.append(el('td', undefined, product.categoryPath.join(' > ')));

    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function exportRow(): HTMLElement {
  const question = currencyQuestion(state.products);
  const allowed = canExport(question, state.currencyAnswer);

  const row = el('div', 'row');
  const button = el('button');
  button.type = 'button';
  button.textContent = t('export');
  // The rule lives in `currency.ts`; this only reflects it.
  button.disabled = !allowed;
  row.append(button);

  const status = el('span', allowed ? 'small muted' : 'small');
  if (!allowed) status.style.color = 'var(--warn)';
  status.textContent = allowed
    ? question.needed
      ? t('currencyConfirmed')
      : ''
    : t('exportBlocked');
  row.append(status);

  return row;
}

function renderScan(): void {
  const view = element('view-scan');
  view.replaceChildren();

  view.append(summaryLine());
  const currency = currencyCard();
  if (currency !== undefined) view.append(currency);
  view.append(productTable());
  view.append(exportRow());
}

/* ---------------------------------------------------------- other views */

function renderInspect(): void {
  const view = element('view-inspect');
  view.replaceChildren();

  const card = el('div', 'card stack');
  card.append(el('h1', undefined, t('inspectTitle')));
  card.append(el('p', 'muted', t('inspectSoon')));
  view.append(card);
}

function labelled(labelText: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'row');
  const label = el('label', undefined, labelText);
  label.style.minWidth = '140px';
  row.append(label, control);
  return row;
}

function renderSettings(): void {
  const view = element('view-settings');
  view.replaceChildren();

  const card = el('div', 'card stack');
  card.append(el('h1', undefined, t('settingsTitle')));

  const language = el('select');
  for (const [value, text] of [
    ['en', 'English'],
    ['fa', 'فارسی'],
  ] as const) {
    const option = el('option', undefined, text);
    option.value = value;
    language.append(option);
  }
  language.value = state.language;
  language.addEventListener('change', () => {
    state.language = language.value as Language;
    renderAll();
  });
  card.append(labelled(t('language'), language));

  const theme = el('select');
  for (const value of ['system', 'light', 'dark'] as const) {
    const option = el(
      'option',
      undefined,
      t(`theme${value[0]?.toUpperCase()}${value.slice(1)}` as MessageKey)
    );
    option.value = value;
    theme.append(option);
  }
  theme.value = state.theme;
  theme.addEventListener('change', () => {
    state.theme = theme.value as Theme;
    applyTheme();
  });
  card.append(labelled(t('theme'), theme));

  const host = el('span', 'badge', hostLabel);
  card.append(labelled(t('host'), host));

  view.append(card);
}

/* ------------------------------------------------------------------ boot */

/**
 * What the native side reports about the machine.
 *
 * Read through Tauri's `invoke`, and behind a guard: the same bundle is opened
 * directly in a browser during development, where `window.__TAURI__` does not
 * exist. Failing to read it is not worth an error — the label simply says so.
 */
let hostLabel = '—';

interface TauriGlobal {
  core?: { invoke?: (command: string) => Promise<unknown> };
}

async function readHost(): Promise<void> {
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (invoke === undefined) {
    hostLabel = 'browser (no native host)';
    return;
  }
  try {
    const info = (await invoke('host_info')) as { platform?: string; version?: string };
    hostLabel = `${info.platform ?? '?'} · ${info.version ?? '?'}`;
  } catch {
    hostLabel = 'unavailable';
  }
}

function renderAll(): void {
  applyLanguage();
  applyTheme();
  showRoute();
  renderScan();
  renderInspect();
  renderSettings();
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route]')) {
  button.addEventListener('click', () => {
    state.route = (button.dataset['route'] ?? 'scan') as Route;
    showRoute();
  });
}

void (async (): Promise<void> => {
  await readHost();
  renderAll();
})();
