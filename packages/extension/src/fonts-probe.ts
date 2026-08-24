/**
 * What the fonts actually resolved to, measured in the page.
 *
 * Phase 13's engine reads `@font-face` blocks, font-service query strings and
 * inline `style` attributes out of a parsed string. Three things it cannot know
 * that way, and this is the surface that can:
 *
 * 1. **Which elements use a family.** A stylesheet does not say which elements
 *    matched it. `FontFamily.usedBy` is only ever filled from here.
 * 2. **Which family in a stack won.** `font-family: Vazirmatn, Tahoma, sans-serif`
 *    declares three and only the engine that laid the page out knows which one
 *    it found. `getComputedStyle` reports the stack, so the first entry is
 *    taken — that is the one in use when the font loaded.
 * 3. **Families from a stylesheet on the shop's own domain.** `core` records a
 *    `<link>` to `/theme/style.css` as an origin but invents no families from
 *    it, because reading it means fetching it. Here they simply show up as
 *    computed values.
 *
 * Like `picker.ts`, this is handed to `chrome.scripting.executeScript`, which
 * serializes it with `toString()` — **so it must close over nothing.** Every
 * constant and helper is inline, which is why it reads more repetitively than
 * the rest of this codebase.
 *
 * It only reads. §16: the inspector never modifies the page it is looking at.
 */

/** Mirrors `ComputedFontUsage` in `core`, which this cannot import from here. */
export interface ProbedFontUsage {
  selector: string;
  family: string;
  weight?: string;
  style?: string;
}

/**
 * Measure the fonts in use, as a bounded sample.
 *
 * **Bounded on purpose.** A category page is routinely twenty thousand
 * elements, `getComputedStyle` forces layout on each one, and the popup is
 * waiting. Sampling by *label* rather than by element is also what makes the
 * result readable: nobody wants six hundred rows saying `div`. Elements are
 * grouped by a short, human-meaningful label and the first hit per
 * label-plus-family wins, so what comes back is "headings use Vazirmatn 700"
 * rather than a transcript of the DOM.
 */
export function fontsProbeScript(maxElements: number): ProbedFontUsage[] {
  // Tags worth naming in a report. Everything else is folded into its nearest
  // structural ancestor's label or skipped — `<span>` is not an answer.
  const LABELLED = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'a',
    'button',
    'input',
    'textarea',
    'select',
    'label',
    'li',
    'td',
    'th',
    'blockquote',
    'code',
    'pre',
  ];

  const found: ProbedFontUsage[] = [];
  const seen = new Set<string>();

  // `body` first, because it is the page's default and the single most useful
  // line in the whole report.
  const roots: Element[] = [];
  if (document.body !== null) roots.push(document.body);

  const all = document.body === null ? [] : Array.from(document.body.querySelectorAll('*'));
  let examined = 0;

  for (const element of roots.concat(all)) {
    if (examined >= maxElements) break;

    const tag = element.tagName.toLowerCase();
    // The extension's own injected UI is not part of the page being inspected.
    if (element.hasAttribute('data-proc123-ui')) continue;
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;

    const label = element === document.body ? 'body' : LABELLED.indexOf(tag) === -1 ? '' : tag;
    if (label === '') continue;

    // An element with no rendered text tells you nothing about type. This also
    // skips anything `display:none`, which has no meaningful computed font.
    const text = (element.textContent ?? '').trim();
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (text === '' && !isField) continue;

    examined += 1;

    const computed = window.getComputedStyle(element);
    const stack = computed.fontFamily;
    if (stack === '') continue;

    // First entry of the resolved stack, quotes stripped. That is the family
    // the page is asking for; which one the system actually had is not
    // something the DOM will tell us either way.
    const first = stack.split(',')[0];
    if (first === undefined) continue;
    const family = first
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (family === '') continue;

    const key = label + '|' + family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const usage: ProbedFontUsage = { selector: label, family };
    if (computed.fontWeight !== '') usage.weight = computed.fontWeight;
    if (computed.fontStyle !== '') usage.style = computed.fontStyle;
    found.push(usage);
  }

  return found;
}

/**
 * How many elements the probe will look at.
 *
 * High enough that a real page's headings, body copy, buttons and table cells
 * are all reached; low enough that a twenty-thousand-element category listing
 * does not make the popup sit there. The sample is deduplicated by label, so
 * raising this mostly buys repetition rather than coverage.
 */
export const FONT_PROBE_LIMIT = 1500;
