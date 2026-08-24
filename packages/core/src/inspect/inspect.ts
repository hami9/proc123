/**
 * The inspector's one entry point.
 *
 * The three questions — what built this, what does it set in type, what images
 * does it reference — are asked together on every surface, and each of the
 * three parses the same document. Doing it once here means the extension and
 * the app share not just the rules but the parse, and neither has to know that
 * `inspectFonts` wants the same `$` that `detectTechnologies` does.
 *
 * Nothing here fetches (CLAUDE.md §16). Every function takes a document that
 * has already been retrieved, which is what lets the whole inspector run inside
 * a popup without a single request against the shop's server and without
 * touching §10's politeness budget.
 */

import { type CheerioAPI, loadHtml } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';
import { inspectFonts } from './fonts.js';
import { inspectImages } from './images.js';
import { detectTechnologies } from './technologies.js';
import type { InspectFontsOptions, PageInspection } from './types.js';

export interface InspectPageOptions extends InspectFontsOptions {
  /**
   * A parse of `page.html` the caller already has.
   *
   * Layer B has usually parsed the document a moment earlier, and parsing a
   * large product page twice is the kind of waste that is invisible until a
   * popup is inspecting a 900KB category listing.
   */
  $?: CheerioAPI;
}

/**
 * Everything the inspector can say about one document.
 *
 * Each of the three lists is empty when the page states nothing of that kind,
 * which is a real answer rather than a failure — a hand-written page genuinely
 * uses no recognised technology, and a page that leaves typography to an
 * external stylesheet genuinely declares no font. §16 asks for an honest
 * nothing over a confident guess, and this is where that shows up.
 */
export function inspectPage(page: PageContext, options: InspectPageOptions = {}): PageInspection {
  const $ = options.$ ?? loadHtml(page.html);

  return {
    url: page.url,
    technologies: detectTechnologies(page, $),
    fonts: inspectFonts(page, $, options),
    images: inspectImages(page, $),
  };
}
