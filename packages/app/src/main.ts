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

import { type BridgeInfo, bridgeInfo, formatToken, onHandoff } from './bridge.js';
import { canExport, currencyQuestion, readingsOf } from './currency.js';
import { type IconName, icon, isIconName } from './icons.js';
import { saveTextFile } from './save.js';
import { scanCategory, scanHandedPage } from './scan.js';
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
  /** Where the bridge is listening and its pairing code, or absent (§17). */
  bridge: BridgeInfo | undefined;
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
  bridge: undefined,
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
  const wrap = el('div', 'stack');

  const head = el('header', 'page-head');
  head.append(el('h1', undefined, t('scanTitle')));
  head.append(el('p', 'lede', t('scanLede')));
  wrap.append(head);

  const card = el('div', 'card stack');

  const label = el('label', 'small muted', t('urlLabel'));
  label.htmlFor = 'scan-url';
  card.append(label);

  const bar = el('div', 'scanbar');
  const field = el('div', 'field-wrap');
  const input = el('input');
  input.id = 'scan-url';
  input.type = 'text';
  input.value = state.url;
  input.placeholder = t('urlPlaceholder');
  // `dir="ltr"` even in Persian: a URL is not Persian text and reads as
  // nonsense when the browser bidi-reorders it.
  input.dir = 'ltr';
  input.spellcheck = false;
  field.append(icon('globe'), input);

  const button = el('button');
  button.type = 'button';
  button.append(icon('scan'), document.createTextNode(state.busy ? t('scanning') : t('startScan')));
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

  bar.append(field, button);
  card.append(bar);

  // §18: honest progress. The bar says something is happening; the line under
  // it says what. Neither is shown when nothing is.
  if (state.busy) {
    const progress = el('div', 'progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', t('scanning'));
    card.append(progress);
  }

  if (state.message !== '') {
    const status = el('p', 'status');
    status.setAttribute('role', 'status');
    status.textContent = state.message;
    card.append(status);
  } else {
    card.append(el('p', 'muted small', t('politeNote')));
  }

  wrap.append(card);
  return wrap;
}

/** One number with its label, the way a result is read at a glance. */
function stat(value: number, label: string): HTMLElement {
  const tile = el('div', 'stat');
  tile.append(el('span', 'stat-value', n(value)), el('span', 'stat-label', label));
  return tile;
}

function summaryLine(): HTMLElement | undefined {
  const summary = state.summary;
  if (summary === undefined) return undefined;

  const products = state.products.filter((product) => product.kind !== 'variation').length;
  const variations = state.products.filter((product) => product.kind === 'variation').length;

  const card = el('section', 'card stack');
  card.append(el('h2', undefined, t('resultsTitle')));

  const stats = el('div', 'stats');
  stats.append(
    stat(products, t('statProducts')),
    stat(variations, t('statVariations')),
    stat(state.products.length, t('statRows')),
    stat(summary.pagesScanned, t('statPages'))
  );
  card.append(stats);

  // Where the answer came from. Small, because it is provenance rather than
  // the result — but on screen, because §18 wants a scan to explain itself.
  const chips = el('div', 'chips');
  chips.append(el('span', 'chip', `${t('readFrom')}: ${summary.platform} · ${summary.layer}`));
  if (state.path !== undefined) {
    chips.append(
      el(
        'span',
        'chip',
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
    chips.append(el('span', 'chip', `${t('markupSize')}: ${sizes}`));
  }
  card.append(chips);

  // Equal sizes mean the WebView returned what the fetch already had, so
  // whatever is missing is missing for a reason that has nothing to do with
  // JavaScript. Saying so beats letting the user conclude rendering is broken.
  if (bytes?.rendered !== undefined && bytes.rendered > 0 && bytes.rendered <= bytes.static) {
    card.append(el('p', 'small muted', t('renderAddedNothing')));
  }

  // §18 asks for honest progress and honest outcomes — what was skipped and
  // why belongs on screen, not only in a log.
  // Deduplicated by message: core reports one issue per product, and two
  // identical lines say less than one line with a count.
  const seen = new Map<string, { issue: (typeof summary.issues)[number]; count: number }>();
  for (const issue of summary.issues) {
    const entry = seen.get(issue.message);
    if (entry === undefined) seen.set(issue.message, { issue, count: 1 });
    else entry.count += 1;
  }
  const shown = [...seen.values()].slice(0, 4);
  if (shown.length > 0) {
    const list = el('ul', 'issues');
    for (const { issue, count } of shown) {
      const tone =
        issue.severity === 'error'
          ? 'tone-error'
          : issue.severity === 'warning'
            ? 'tone-warn'
            : 'muted';
      const item = el('li', tone);
      item.append(
        icon(
          issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'about'
        )
      );
      // `core`'s messages are English. `dir="auto"` lets each one keep its own
      // direction inside a Persian page; without it the bidi algorithm moves the
      // closing full stop to the front of the line.
      const text = el(
        'span',
        undefined,
        count > 1 ? `${issue.message} (×${n(count)})` : issue.message
      );
      text.dir = 'auto';
      item.append(text);
      list.append(item);
    }
    card.append(list);
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
  card.setAttribute('aria-labelledby', 'currency-title');
  const title = el('h2', 'section-title');
  title.id = 'currency-title';
  title.append(icon('warning'), el('span', undefined, t('currencyTitle')));
  card.append(title);
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

    row.append(el('td', 'kind', product.kind));

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

  const bar = el('div', 'export-bar');
  const button = el('button');
  button.type = 'button';
  button.append(icon('download'), document.createTextNode(t('export')));
  // The rule lives in `currency.ts`; this only reflects it.
  button.disabled = !allowed || state.busy;
  button.addEventListener('click', () => {
    void exportCsv();
  });
  bar.append(button);

  if (!allowed) {
    const status = el('span', 'status tone-warn');
    status.append(icon('warning'), el('span', undefined, t('exportBlocked')));
    bar.append(status);
  } else if (question.needed) {
    const status = el('span', 'status tone-ok');
    status.append(icon('check'), el('span', undefined, t('currencyConfirmed')));
    bar.append(status);
  }

  return bar;
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

/**
 * What a view shows when it has nothing yet: what is missing and what to do.
 * A blank region reads as broken; one sentence and an icon reads as "start
 * here".
 */
function emptyState(name: IconName, title: string, body: string): HTMLElement {
  const box = el('div', 'empty');
  const halo = el('span', 'halo');
  halo.append(icon(name));
  box.append(halo, el('h2', undefined, title), el('p', 'muted', body));
  return box;
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
    view.append(emptyState('empty', t('emptyTitle'), t('noResults')));
  }

  const exportControls = exportRow();
  if (exportControls !== undefined) view.append(exportControls);
}

/* ---------------------------------------------------------- other views */

function renderInspect(): void {
  const view = element('view-inspect');
  view.replaceChildren();

  const head = el('header', 'page-head');
  head.append(el('h1', undefined, t('inspectTitle')));
  view.append(head);
  view.append(emptyState('inspect', t('inspectTitle'), t('inspectSoon')));
}

/** A label and its control, on a shared grid so every setting lines up. */
let fieldCount = 0;
function labelled(labelText: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'field');
  const label = el('label', undefined, labelText);
  // Explicit association, so clicking the label focuses the control and a
  // screen reader announces the two together.
  fieldCount += 1;
  control.id = `field-${String(fieldCount)}`;
  label.htmlFor = control.id;
  row.append(label, control);
  return row;
}

/**
 * A note that belongs to the field above it, placed *inside* that field so the
 * grid puts it under the control it is about rather than under the label.
 */
function noteUnder(container: HTMLElement, text: string, tone?: 'tone-warn'): void {
  const note = el('p', tone === undefined ? 'field-note muted' : `field-note ${tone}`, text);
  const field = container.lastElementChild;
  if (field instanceof HTMLElement && field.classList.contains('field')) field.append(note);
  else container.append(note);
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
  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (Number.isFinite(next) && next >= min) onChange(next);
  });
  return labelled(labelText, input);
}

function renderSettings(): void {
  const view = element('view-settings');
  view.replaceChildren();

  const head = el('header', 'page-head');
  head.append(el('h1', undefined, t('settingsTitle')));
  view.append(head);

  const appearance = el('section', 'card');
  appearance.append(el('h2', undefined, t('settingsAppearance')));

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
  const scanning = el('section', 'card');
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
    noteUnder(scanning, t('contentWarning'), 'tone-warn');
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
    noteUnder(scanning, t('politeWarning'), 'tone-warn');
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
  noteUnder(scanning, t('displayUnitNote'));

  view.append(scanning);
}

function renderAbout(): void {
  const view = element('view-about');
  view.replaceChildren();

  const head = el('header', 'page-head');
  head.append(el('h1', undefined, t('aboutTitle')));
  head.append(el('p', 'lede', t('aboutWhat')));
  const meta = el('div', 'chips');
  meta.append(el('span', 'chip', `${t('version')} ${appVersion}`));
  meta.append(el('span', 'chip', `${t('host')}: ${hostLabel}`));
  head.append(meta);
  view.append(head);

  // §17, where the person who has to type the code can see it. The app does not
  // need the extension and says so in both states — a pairing panel that reads
  // like a setup step would make an enhancement look like a requirement.
  const bridge = el('section', 'card stack');
  const bridgeTitle = el('h2', 'section-title');
  bridgeTitle.append(icon('plug'), el('span', undefined, t('bridgeTitle')));
  bridge.append(bridgeTitle);
  bridge.append(el('p', 'muted', t('bridgeWhat')));
  if (state.bridge === undefined) {
    bridge.append(el('p', 'small muted', t('bridgeOff')));
  } else {
    const code = el('div', 'row');
    code.append(el('span', 'small muted', t('bridgePairing')));
    code.append(el('span', 'code', formatToken(state.bridge.token)));
    code.append(el('span', 'chip', `127.0.0.1:${String(state.bridge.port)}`));
    bridge.append(code);
    bridge.append(el('p', 'small muted', t('bridgeHow')));
  }
  view.append(bridge);

  // §15's promise, stated where a user can read it rather than only in a
  // repository nobody opens.
  const privacy = el('section', 'card stack');
  const privacyTitle = el('h2', 'section-title');
  privacyTitle.append(icon('shield'), el('span', undefined, t('aboutPrivacyTitle')));
  privacy.append(privacyTitle);
  privacy.append(el('p', 'muted', t('aboutPrivacy')));
  view.append(privacy);

  // §2's hard constraint, same reasoning.
  const limits = el('section', 'card stack');
  limits.append(el('h2', undefined, t('aboutLimitsTitle')));
  limits.append(el('p', 'muted', t('aboutLimits')));
  view.append(limits);

  const line = el('p', 'small muted');
  line.append(document.createTextNode(`${t('aboutLicence')} `));
  const link = el('a', undefined, 'github.com/hami9/proc123');
  link.href = 'https://github.com/hami9/proc123';
  link.target = '_blank';
  link.rel = 'noreferrer';
  line.append(link);
  view.append(line);
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

/**
 * A page arrived from the extension (§17).
 *
 * It is treated exactly like a scan the user started here — same state, same
 * currency question, same export path — because it *is* one. The only
 * difference is where the first page came from, and the user still answers
 * §7.8's toman/rial question before anything is written. A handoff must never
 * become a route that skips that; it is the one failure this project most wants
 * to avoid, and "the extension already looked at it" is not an answer to it.
 *
 * A handoff arriving mid-scan is ignored rather than queued. Two crawls at once
 * would double the load on somebody's shop (§10), and the user can send it
 * again.
 */
async function receiveHandoff(handoff: { url: string; title: string; html: string }) {
  if (state.busy) return;

  state.busy = true;
  state.url = handoff.url;
  state.message = t('bridgeHandoffReceived');
  state.currencyAnswer = undefined;
  state.products = [];
  state.summary = undefined;
  state.path = undefined;
  state.bytes = undefined;
  state.route = 'scan';
  showRoute();
  renderScan();

  try {
    const result = await scanHandedPage({
      url: handoff.url,
      title: handoff.title,
      html: handoff.html,
      config: state.config,
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
    state.message = `${t('scanFailed')} — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.busy = false;
    renderScan();
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

/**
 * Swap each `[data-icon]` placeholder in the static markup for its SVG. Done
 * once: the sidebar is never re-rendered, so there is nothing to keep in step.
 */
function fillIcons(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = slot.dataset['icon'];
    if (isIconName(name)) slot.replaceWith(icon(name));
  }
}

void (async (): Promise<void> => {
  fillIcons();
  await readHost();
  state.bridge = await bridgeInfo();
  element('sidebar-foot').textContent = `v${appVersion}`;
  renderAll();

  // Subscribed for the life of the window. There is nothing to unsubscribe
  // from on a page that never navigates, and in a plain browser this is a
  // no-op — which is what keeps the no-bridge case the ordinary path (§17).
  await onHandoff((handoff) => {
    void receiveHandoff(handoff);
  });
})();
