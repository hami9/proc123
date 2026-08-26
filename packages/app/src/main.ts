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

import type {
  CanonicalProduct,
  ContentMode,
  CurrencyUnit,
  ExporterName,
  Proc123Config,
  ScanProgress,
  ScanSummary,
} from '@proc123/core';
import { ALL_EXPORTERS, DEFAULT_CONFIG } from '@proc123/core';
import { EXPORTER_EXTENSIONS, EXPORTER_LABELS, exportProducts } from '@proc123/exporters';

import { canExport, currencyQuestion, readingsOf } from './currency.js';
import { saveTextFile } from './save.js';
import { scanCategory } from './scan.js';
import {
  type Language,
  type MessageKey,
  directionOf,
  formatAmount,
  localiseDigits,
  translate,
} from './i18n.js';

type Route = 'scan' | 'inspect' | 'settings' | 'about';
type Theme = 'system' | 'light' | 'dark';

interface State {
  language: Language;
  theme: Theme;
  route: Route;
  /** `undefined` until the user answers. Never defaulted — see `currency.ts`. */
  currencyAnswer: CurrencyUnit | undefined;
  products: CanonicalProduct[];
  summary: ScanSummary | undefined;
  /** Which read answered — §18 wants a slower scan to explain itself. */
  path: 'static' | 'rendered' | undefined;
  /** How big each read was. The cheapest test of whether rendering did anything. */
  bytes: { static: number; rendered?: number } | undefined;
  url: string;
  busy: boolean;
  /** What to tell the user right now: progress, an error, or where a file went. */
  message: string;
  /** §9's config, edited in Settings. The single source of the scan's options. */
  config: Proc123Config;
}

const state: State = {
  language: 'en',
  theme: 'system',
  route: 'scan',
  currencyAnswer: undefined,
  products: [],
  summary: undefined,
  path: undefined,
  bytes: undefined,
  url: '',
  busy: false,
  message: '',
  config: DEFAULT_CONFIG,
};

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
};

const t = (key: MessageKey): string => translate(state.language, key);
/** Sizes in KB. Bytes are noise at this scale; the ratio is the whole signal. */
const kb = (bytes: number): string => `${n(Math.round(bytes / 1024))} KB`;
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
  for (const view of ['scan', 'inspect', 'settings', 'about'] as const) {
    element(`view-${view}`).hidden = view !== state.route;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route]')) {
    const route = button.dataset['route'];
    if (route === state.route) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

/* -------------------------------------------------------------- scan view */

/**
 * Where a scan is started.
 *
 * Kept at the top and always present, because it is the thing the app is for.
 */
function scanForm(): HTMLElement {
  const card = el('div', 'card stack');
  card.append(el('h1', undefined, t('scanTitle')));

  const label = el('label', 'small muted', t('urlLabel'));
  card.append(label);

  const row = el('div', 'row');
  const input = el('input');
  input.type = 'text';
  input.value = state.url;
  input.placeholder = t('urlPlaceholder');
  input.style.flex = '1 1 320px';
  // `dir="ltr"` even in Persian: a URL is not Persian text and reads as
  // nonsense when the browser bidi-reorders it.
  input.dir = 'ltr';
  const button = el('button');
  button.type = 'button';
  button.textContent = state.busy ? t('scanning') : t('startScan');
  button.disabled = state.busy || state.url.trim() === '';
  button.addEventListener('click', () => {
    void startScan();
  });

  // The button's enabled state is updated here rather than by re-rendering.
  // A re-render on every keystroke would rebuild the input and take the
  // caret with it, which is unusable; leaving it out entirely was the bug
  // that made Scan look dead — the button was created while the field was
  // empty and nothing ever told it otherwise.
  input.addEventListener('input', () => {
    state.url = input.value;
    button.disabled = state.busy || state.url.trim() === '';
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !button.disabled) void startScan();
  });

  row.append(input, button);
  card.append(row);
  card.append(el('p', 'muted small', t('politeNote')));

  if (state.message !== '') {
    card.append(el('p', 'small', state.message));
  }
  return card;
}

function summaryLine(): HTMLElement | undefined {
  const summary = state.summary;
  if (summary === undefined) return undefined;

  const products = state.products.filter((product) => product.kind !== 'variation').length;
  const variations = state.products.filter((product) => product.kind === 'variation').length;

  const card = el('div', 'card stack');
  card.append(el('h2', undefined, t('resultsTitle')));

  const counts = el('div', 'row');
  counts.append(
    el('strong', undefined, `${n(products)} ${t('products')}`),
    el('span', 'badge', `${n(state.products.length)} ${t('rows')}`),
    el('span', 'badge', `${n(variations)} ${t('variations')}`),
    el('span', 'badge', `${t('readFrom')}: ${summary.platform} · ${summary.layer}`),
    el('span', 'badge', `${t('pages')}: ${n(summary.pagesScanned)}`)
  );
  if (state.path !== undefined) {
    counts.append(
      el(
        'span',
        'badge',
        `${t('readVia')}: ${state.path === 'rendered' ? t('readRendered') : t('readStatic')}`
      )
    );
  }

  // How big each read was. This is the cheapest possible answer to "did
  // rendering actually do anything?", and without it a scan that finds nothing
  // is indistinguishable from a renderer that silently handed back the shell.
  const bytes = state.bytes;
  if (bytes !== undefined) {
    const sizes =
      bytes.rendered === undefined
        ? kb(bytes.static)
        : `${kb(bytes.static)} → ${kb(bytes.rendered)}`;
    counts.append(el('span', 'badge', `${t('markupSize')}: ${sizes}`));
  }
  card.append(counts);

  // Equal sizes mean the WebView returned what the fetch already had, so
  // whatever is missing is missing for a reason that has nothing to do with
  // JavaScript. Saying so beats letting the user conclude rendering is broken.
  if (bytes?.rendered !== undefined && bytes.rendered <= bytes.static) {
    card.append(el('p', 'small muted', t('renderAddedNothing')));
  }

  // §18 asks for honest progress and honest outcomes — what was skipped and
  // why belongs on screen, not only in a log.
  for (const issue of summary.issues.slice(0, 4)) {
    const line = el('p', 'small');
    if (issue.severity === 'error') line.style.color = 'var(--error)';
    else if (issue.severity === 'warning') line.style.color = 'var(--warn)';
    line.textContent = issue.message;
    card.append(line);
  }
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

function exportRow(): HTMLElement | undefined {
  if (state.products.length === 0) return undefined;

  const question = currencyQuestion(state.products);
  const allowed = canExport(question, state.currencyAnswer);

  const row = el('div', 'row');
  const button = el('button');
  button.type = 'button';
  button.textContent = t('export');
  // The rule lives in `currency.ts`; this only reflects it.
  button.disabled = !allowed || state.busy;
  button.addEventListener('click', () => {
    void exportCsv();
  });
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

/* ------------------------------------------------------------------ actions */

/**
 * Run a scan and put its result on screen.
 *
 * The pipeline is `core`'s; this reports progress and failures. §18 asks for
 * honest progress rather than a spinner that says nothing — a scan of a large
 * catalogue takes minutes, and silence for that long is indistinguishable from
 * a hang.
 */
async function startScan(): Promise<void> {
  const url = state.url.trim();
  if (url === '' || state.busy) return;

  state.busy = true;
  state.message = t('scanning');
  // A new scan invalidates the previous answer: it is a different shop with
  // different prices, and carrying the old confirmation forward would be
  // answering §7.8's question on the user's behalf.
  state.currencyAnswer = undefined;
  state.products = [];
  state.summary = undefined;
  // Otherwise a static scan after a rendered one keeps the old badge and tells
  // the user the page was rendered when it was not.
  state.path = undefined;
  state.bytes = undefined;
  renderScan();

  try {
    const result = await scanCategory({
      url,
      config: state.config,
      onRenderFallback: () => {
        // Rendering takes seconds and looks like a hang otherwise. Saying what
        // is happening, and why, is §18's honest-progress rule.
        state.message = t('rendering');
        renderScan();
      },
      onProgress: (progress: ScanProgress) => {
        state.message =
          `${t('scanning')} ${t('pages')} ${n(progress.pagesScanned)} · ` +
          `${n(progress.productCount)} ${t('products')}`;
        renderScan();
      },
    });

    state.summary = result.summary;
    state.products = result.products;
    state.path = result.path;
    state.bytes = result.bytes;
    state.message = '';
  } catch (error) {
    // The wording of a block comes from `core`'s own error (§2); this only
    // shows it.
    state.message = `${t('scanFailed')} — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.busy = false;
    renderScan();
  }
}

/**
 * Write the CSV.
 *
 * The exporter is `packages/exporters`, shared with the other two surfaces, so
 * every §7 rule — the BOM, the headers, the parent/variation ordering — has one
 * home. The unit passed to it is the one the user confirmed, never a default.
 */
async function exportCsv(): Promise<void> {
  const question = currencyQuestion(state.products);
  if (!canExport(question, state.currencyAnswer)) return;

  state.busy = true;
  state.message = t('saving');
  renderScan();

  try {
    // `?? 'toman'` is reached only when the question was never real — every
    // price already stated its unit — so it is a formality rather than a guess.
    const displayUnit = state.currencyAnswer ?? 'toman';
    const exporter = state.config.exporter;
    const shared = {
      displayUnit,
      currencyCode: state.config.currency.code,
      contentMode: state.config.contentMode,
      bom: true,
    };

    const outcome = exportProducts(state.products, exporter, {
      woocommerce: shared,
      shopify: shared,
      json: { scannedUrl: state.url },
    });

    let host = 'export';
    try {
      host = new URL(state.url).hostname.replace(/^www\./, '');
    } catch {
      // A malformed URL is not worth failing an export over.
    }
    const date = new Date().toISOString().slice(0, 10);
    const name = `proc123-${host}-${date}.${EXPORTER_EXTENSIONS[exporter]}`;

    const saved = await saveTextFile(name, outcome.text);
    state.message = saved.saved ? `${t('saved')} ${saved.path ?? ''}` : t('saveCancelled');
  } catch (error) {
    state.message = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    renderScan();
  }
}

function renderScan(): void {
  const view = element('view-scan');
  view.replaceChildren();

  view.append(scanForm());

  const summary = summaryLine();
  if (summary !== undefined) view.append(summary);

  const currency = currencyCard();
  if (currency !== undefined) view.append(currency);

  if (state.products.length > 0) {
    view.append(productTable());
  } else if (!state.busy && state.summary === undefined) {
    view.append(el('p', 'muted', t('noResults')));
  }

  const exportControls = exportRow();
  if (exportControls !== undefined) view.append(exportControls);
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

function selectRow(
  labelText: string,
  options: readonly (readonly [value: string, text: string])[],
  current: string,
  onChange: (value: string) => void
): HTMLElement {
  const select = el('select');
  for (const [value, text] of options) {
    const option = el('option', undefined, text);
    option.value = value;
    select.append(option);
  }
  select.value = current;
  select.addEventListener('change', () => {
    onChange(select.value);
  });
  return labelled(labelText, select);
}

function numberRow(
  labelText: string,
  value: number,
  min: number,
  onChange: (value: number) => void
): HTMLElement {
  const input = el('input');
  input.type = 'number';
  input.min = String(min);
  input.value = String(value);
  input.style.width = '120px';
  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (Number.isFinite(next) && next >= min) onChange(next);
  });
  return labelled(labelText, input);
}

function renderSettings(): void {
  const view = element('view-settings');
  view.replaceChildren();

  const appearance = el('div', 'card stack');
  appearance.append(el('h1', undefined, t('settingsTitle')));

  appearance.append(
    selectRow(
      t('language'),
      [
        ['en', 'English'],
        ['fa', 'فارسی'],
      ],
      state.language,
      (value) => {
        state.language = value as Language;
        renderAll();
      }
    )
  );

  appearance.append(
    selectRow(
      t('theme'),
      [
        ['system', t('themeSystem')],
        ['light', t('themeLight')],
        ['dark', t('themeDark')],
      ],
      state.theme,
      (value) => {
        state.theme = value as Theme;
        applyTheme();
      }
    )
  );
  view.append(appearance);

  // Scanning. These are `core`'s `Proc123Config` fields, edited in place — the
  // config is the single source of the pipeline's options (§9) and nothing here
  // assembles its own.
  const scanning = el('div', 'card stack');
  scanning.append(el('h2', undefined, t('settingsScanning')));

  scanning.append(
    selectRow(
      t('exporter'),
      ALL_EXPORTERS.map((name) => [name, EXPORTER_LABELS[name]] as const),
      state.config.exporter,
      (value) => {
        state.config = { ...state.config, exporter: value as ExporterName };
      }
    )
  );

  scanning.append(
    selectRow(
      t('contentMode'),
      [
        ['structured-only', t('contentStructured')],
        ['reference', t('contentReference')],
        ['rewrite', t('contentRewrite')],
      ],
      state.config.contentMode,
      (value) => {
        state.config = { ...state.config, contentMode: value as ContentMode };
        renderSettings();
      }
    )
  );
  if (state.config.contentMode !== 'structured-only') {
    // §8: descriptions are somebody's authored content. Saying so at the moment
    // the setting changes is the point.
    const warn = el('p', 'small', t('contentWarning'));
    warn.style.color = 'var(--warn)';
    scanning.append(warn);
  }

  scanning.append(
    numberRow(t('maxPages'), state.config.maxPages, 1, (value) => {
      state.config = { ...state.config, maxPages: value };
    })
  );

  scanning.append(
    numberRow(t('delayMs'), state.config.politeness.delayMsBetweenRequests, 0, (value) => {
      state.config = {
        ...state.config,
        politeness: { ...state.config.politeness, delayMsBetweenRequests: value },
      };
      renderSettings();
    })
  );
  if (state.config.politeness.delayMsBetweenRequests < 400) {
    // §10 is about not degrading somebody else's server, so shortening the
    // delay gets said out loud rather than accepted silently.
    const warn = el('p', 'small', t('politeWarning'));
    warn.style.color = 'var(--warn)';
    scanning.append(warn);
  }

  scanning.append(
    numberRow(t('maxConcurrent'), state.config.politeness.maxConcurrent, 1, (value) => {
      state.config = {
        ...state.config,
        politeness: { ...state.config.politeness, maxConcurrent: value },
      };
    })
  );

  scanning.append(
    selectRow(
      t('displayUnit'),
      [
        ['toman', t('currencyToman')],
        ['rial', t('currencyRial')],
      ],
      state.config.currency.displayUnit,
      (value) => {
        state.config = {
          ...state.config,
          currency: { ...state.config.currency, displayUnit: value as CurrencyUnit },
        };
      }
    )
  );
  // The one thing this setting must not become is an answer to §7.8's
  // question. It is a starting point; the export still asks.
  scanning.append(el('p', 'muted small', t('displayUnitNote')));

  view.append(scanning);
}

function renderAbout(): void {
  const view = element('view-about');
  view.replaceChildren();

  const card = el('div', 'card stack');
  card.append(el('h1', undefined, t('aboutTitle')));
  card.append(el('p', undefined, t('aboutWhat')));

  const meta = el('div', 'row');
  meta.append(el('span', 'badge', `${t('version')} ${appVersion}`));
  meta.append(el('span', 'badge', `${t('host')}: ${hostLabel}`));
  card.append(meta);
  view.append(card);

  // §15's promise, stated where a user can read it rather than only in a
  // repository nobody opens.
  const privacy = el('div', 'card stack');
  privacy.append(el('h2', undefined, t('aboutPrivacyTitle')));
  privacy.append(el('p', 'small', t('aboutPrivacy')));
  view.append(privacy);

  // §2's hard constraint, same reasoning.
  const limits = el('div', 'card stack');
  limits.append(el('h2', undefined, t('aboutLimitsTitle')));
  limits.append(el('p', 'small', t('aboutLimits')));
  view.append(limits);

  const licence = el('div', 'card stack');
  const line = el('p', 'small');
  line.append(document.createTextNode(`${t('aboutLicence')} `));
  const link = el('a', undefined, 'github.com/hami9/proc123');
  link.href = 'https://github.com/hami9/proc123';
  link.target = '_blank';
  link.rel = 'noreferrer';
  line.append(link);
  licence.append(line);
  view.append(licence);
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
/** From the native side, so one number governs — `Cargo.toml`'s. */
let appVersion = '—';

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
    hostLabel = info.platform ?? '?';
    appVersion = info.version ?? '?';
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
  renderAbout();
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
