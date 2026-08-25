/**
 * Variations read out of the page itself (CLAUDE.md §14 step 5, ROADMAP Phase 5).
 *
 * Layers A and B already produce variations when the shop answers its own API
 * or publishes a schema.org `ProductGroup`. Neither is guaranteed. What *is*
 * effectively guaranteed on a WooCommerce variable product is the add-to-cart
 * form, which carries every variation as JSON in one attribute:
 *
 *   <form class="variations_form" data-product_variations='[{…},{…}]'>
 *
 * That blob is `WC_Product_Variable::get_available_variations()` — per-variation
 * price, sale price, SKU, stock, image, weight and dimensions — already in the
 * page, needing no extra request and surviving a store with its REST API turned
 * off. Reading it is the difference between exporting a variable product as one
 * priceless row and exporting it correctly.
 *
 * **The trap, which is the same one the Store API adapter hit in Phase 3.** A
 * variation's `attributes` map holds term *slugs* (`attribute_pa_weight:
 * "500g"`), while the parent's options are term *names* (`۵۰۰ گرم`). §7.6
 * requires them to match character-for-character or WooCommerce silently drops
 * every variation on import. The `<select>` in the form is the translation
 * table — `<option value="500g">۵۰۰ گرم</option>` — so it is read first and the
 * slugs are mapped back through it.
 */

import type { CanonicalProduct, Money, ProductAttribute } from '../model.js';
import { cleanText } from '../text.js';
import { resolveUrl } from '../url.js';
import { type CheerioAPI, type Element, attr, isElement, loadHtml } from './html.js';
import { type JsonObject, isJsonObject, parseJsonLenient } from './json.js';
import type { ExtractionIssue, ExtractionOptions, PageContext, SourceReading } from './types.js';
import { CONFIDENCE } from './types.js';
import { createDraft, overwriteField, setField, setPricePair, type ProductDraft } from './draft.js';

/**
 * The form's JSON is the shop's own data, not a reading of its prose — the same
 * standing as a Store API answer minus the guarantee that it is current.
 */
const CONFIDENCE_FORM = CONFIDENCE.jsonLd;

/** `attribute_pa_weight` / `attribute_size` -> the axis key. */
const ATTRIBUTE_PREFIX = /^attribute_/;
/** WooCommerce prefixes global (taxonomy) attributes with `pa_`. */
const TAXONOMY_PREFIX = /^pa_/;

export interface VariationFormOptions extends ExtractionOptions {
  /** Currency for prices, which the form states as bare numbers. */
  currency?: string;
}

/** One axis: its key in the JSON, its human label, and slug -> label for values. */
interface Axis {
  key: string;
  label: string;
  values: Map<string, string>;
  /** Option order as the page lists it, which is the order a shopper sees. */
  order: string[];
}

/**
 * De-slugify an attribute key when the form gives no `<label>`.
 *
 * `attribute_pa_weight` -> `weight`. Deliberately minimal: inventing a prettier
 * name than the shop uses would make the parent's column header disagree with
 * what a human sees on the page.
 */
function labelFromKey(key: string): string {
  return key
    .replace(ATTRIBUTE_PREFIX, '')
    .replace(TAXONOMY_PREFIX, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/**
 * Read the axes out of the form's `<select>` elements.
 *
 * Each `<select name="attribute_pa_weight">` is one axis; each `<option>` is a
 * term, with the slug in `value` and the display name as its text. The `<label>`
 * in the same row of `table.variations` is the axis's own display name.
 */
export function readAxes($: CheerioAPI, form: Element): Map<string, Axis> {
  const axes = new Map<string, Axis>();

  $(form)
    .find('select[name^="attribute_"]')
    .each((_, select) => {
      if (!isElement(select)) return;
      const key = attr(select, 'name');
      if (key === undefined || key === '') return;

      const values = new Map<string, string>();
      const order: string[] = [];
      $(select)
        .find('option')
        .each((__, option) => {
          if (!isElement(option)) return;
          const slug = attr(option, 'value');
          // The placeholder "Choose an option" carries an empty value.
          if (slug === undefined || slug === '') return;
          const text = cleanText($(option).text());
          values.set(slug, text === '' ? slug : text);
          order.push(text === '' ? slug : text);
        });

      // The label lives in the row's `<th>`, keyed to the select by `for`.
      const id = attr(select, 'id');
      let label = '';
      if (id !== undefined && id !== '') {
        label = cleanText($(form).find(`label[for="${id}"]`).first().text());
      }
      if (label === '') label = cleanText($(select).closest('tr').find('th,.label').first().text());
      if (label === '') label = labelFromKey(key);

      axes.set(key, { key, label, values, order });
    });

  return axes;
}

function money(amount: unknown, currency: string): Money | undefined {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return { amount: value, currency };
}

/**
 * Turn one entry of `data-product_variations` into a draft.
 *
 * `display_price` is what the shop is charging and `display_regular_price` is
 * the pre-discount figure, so a sale is `display_price < display_regular_price`
 * — the same shape Shopify's `Price` / `Compare-at price` pair has, and the
 * opposite of how WooCommerce names its own CSV columns.
 */
function readVariation(
  node: JsonObject,
  axes: Map<string, Axis>,
  page: PageContext,
  currency: string,
  parentValues: Map<string, string[]>
): ProductDraft {
  const draft = createDraft(page.url);
  setField(draft, 'kind', 'variation', CONFIDENCE_FORM, 'dom');

  const sku = typeof node['sku'] === 'string' ? node['sku'].trim() : '';
  if (sku !== '') setField(draft, 'sku', sku, CONFIDENCE_FORM, 'dom');

  const regular = money(node['display_regular_price'], currency);
  const display = money(node['display_price'], currency);

  // Atomic, so a regular price from here can never pair with a sale price from
  // somewhere else and invent a permanent 0% markdown.
  if (regular !== undefined && display !== undefined && display.amount < regular.amount) {
    setPricePair(draft, { regular, sale: display }, CONFIDENCE_FORM, 'dom');
  } else {
    const only = regular ?? display;
    if (only !== undefined) setPricePair(draft, { regular: only }, CONFIDENCE_FORM, 'dom');
  }

  if (typeof node['is_in_stock'] === 'boolean') {
    setField(draft, 'inStock', node['is_in_stock'], CONFIDENCE_FORM, 'dom');
  }
  // `max_qty` is the purchasable ceiling, which equals stock when the shop
  // manages stock and is an empty string when it does not.
  const maxQty = node['max_qty'];
  if (typeof maxQty === 'number' && Number.isFinite(maxQty) && maxQty > 0) {
    setField(draft, 'stockQuantity', maxQty, CONFIDENCE_FORM, 'dom');
  }

  const image = node['image'];
  if (isJsonObject(image)) {
    const url = typeof image['url'] === 'string' ? image['url'] : undefined;
    const resolved = url === undefined ? undefined : resolveUrl(url, page.url);
    if (resolved !== undefined) setField(draft, 'images', [resolved], CONFIDENCE_FORM, 'dom');
  }

  const weight = Number(node['weight']);
  if (Number.isFinite(weight) && weight > 0) {
    // The form states a bare number; the unit is the shop's setting and is not
    // in the payload, so `kg` is WooCommerce's own default rather than a guess
    // about this shop.
    setField(draft, 'weight', { value: weight, unit: 'kg' }, CONFIDENCE.weak, 'dom');
  }

  const attributes: ProductAttribute[] = [];
  const nodeAttributes = node['attributes'];
  if (isJsonObject(nodeAttributes)) {
    for (const [key, raw] of Object.entries(nodeAttributes)) {
      const axis = axes.get(key);
      const slug = typeof raw === 'string' ? raw : '';
      // An empty value means "Any <attribute>" — this variation matches every
      // term on that axis. WooCommerce's own export writes an empty cell for
      // it, so omitting the attribute is what round-trips.
      if (slug === '') continue;

      const label = axis?.label ?? labelFromKey(key);
      // The translation the whole module exists for: the JSON holds a slug and
      // the parent lists names, and §7.6 needs them identical.
      const value = axis?.values.get(slug) ?? slug;

      attributes.push({ name: label, values: [value], isVariationAxis: true });
      const collected = parentValues.get(label) ?? [];
      if (!collected.includes(value)) collected.push(value);
      parentValues.set(label, collected);
    }
  }

  overwriteField(draft, 'attributes', attributes, CONFIDENCE_FORM, 'dom');
  return draft;
}

/** Dimensions are a nested object of bare numbers, in the shop's own unit. */
function readDimensions(node: JsonObject): CanonicalProduct['dimensions'] | undefined {
  const source = node['dimensions'];
  if (!isJsonObject(source)) return undefined;

  const read = (key: string): { value: number; unit: 'cm' } | undefined => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value > 0 ? { value, unit: 'cm' } : undefined;
  };

  const length = read('length');
  const width = read('width');
  const height = read('height');
  if (length === undefined && width === undefined && height === undefined) return undefined;

  return {
    ...(length === undefined ? {} : { length }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

/**
 * Read a WooCommerce variation form.
 *
 * Returns a reading rather than products: the parent's name, categories and
 * description come from the rest of the page, and merging is Layer B's job.
 */
export function readVariationForm(
  page: PageContext,
  options: VariationFormOptions = {},
  loaded?: CheerioAPI
): SourceReading {
  const $ = loaded ?? loadHtml(page.html);
  const issues: ExtractionIssue[] = [];
  const drafts: ProductDraft[] = [];
  const currency = options.defaultCurrency ?? options.currency ?? 'IRR';

  $('form.variations_form').each((_, form) => {
    if (!isElement(form)) return;

    const raw = attr(form, 'data-product_variations');
    if (raw === undefined || raw === '' || raw === 'false') {
      // `false` is WooCommerce's own signal that it declined to inline them.
      // Current trunk always inlines, but the template still guards for it and
      // themes override the template, so this stays an ordinary outcome.
      issues.push({
        severity: 'info',
        code: 'variation-form-not-inlined',
        source: 'dom',
        url: page.url,
        message:
          'This product has variations but the page did not include their details, so only the ' +
          'parent was read. Its variations would need the shop’s own API.',
      });
      return;
    }

    const { value: parsed } = parseJsonLenient(raw);
    if (!Array.isArray(parsed)) {
      issues.push({
        severity: 'warning',
        code: 'variation-form-unreadable',
        kind: 'parse-failed',
        source: 'dom',
        url: page.url,
        message: 'A variation form was present but its data could not be read.',
      });
      return;
    }

    const axes = readAxes($, form);
    const parentValues = new Map<string, string[]>();
    const variations: ProductDraft[] = [];

    for (const entry of parsed) {
      if (!isJsonObject(entry)) continue;
      variations.push(readVariation(entry, axes, page, currency, parentValues));
    }

    if (variations.length === 0) return;

    const parent = createDraft(page.url);
    setField(parent, 'kind', 'variable', CONFIDENCE_FORM, 'dom');

    // The parent lists every option in the order the `<select>` offers them,
    // falling back to the order the variations happened to mention. §7.6: these
    // strings must match the variation rows character-for-character.
    const parentAttributes: ProductAttribute[] = [...parentValues].map(([name, seen]) => {
      const axis = [...axes.values()].find((candidate) => candidate.label === name);
      const ordered =
        axis === undefined ? seen : axis.order.filter((value) => seen.includes(value));
      return {
        name,
        values: ordered.length > 0 ? ordered : seen,
        isVariationAxis: true,
      };
    });
    overwriteField(parent, 'attributes', parentAttributes, CONFIDENCE_FORM, 'dom');

    // §7.5: a variable parent's price cells stay empty. The per-variation
    // prices are the real ones, and a parent price would import as a product
    // sold at a figure the shop never quoted.
    parent.variants.push(...variations);
    drafts.push(parent);

    const dimensioned = parsed.find(
      (entry): entry is JsonObject => isJsonObject(entry) && readDimensions(entry) !== undefined
    );
    if (dimensioned !== undefined) {
      const dimensions = readDimensions(dimensioned);
      if (dimensions !== undefined) {
        setField(parent, 'dimensions', dimensions, CONFIDENCE.weak, 'dom');
      }
    }
  });

  return { source: 'dom', drafts, discoveredUrls: [], breadcrumb: [], issues };
}

/** Exported for the unit tests and for Layer C, which faces the same slugs. */
export { labelFromKey };
