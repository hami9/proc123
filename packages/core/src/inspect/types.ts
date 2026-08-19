/**
 * What the inspector reports.
 *
 * Every one of these describes a document that was already fetched. Nothing
 * here implies a request, and no field may be filled by making one — where a
 * value can only be known by downloading the asset, the field is absent and
 * the surface that has a network budget (the app, §15) fills it later.
 */

export type TechnologyCategory =
  | 'ecommerce'
  | 'cms'
  | 'framework'
  | 'analytics'
  | 'tag-manager'
  | 'cdn'
  | 'payment'
  | 'chat'
  | 'font-service'
  | 'error-tracking';

export interface Technology {
  /** Stable machine id, e.g. `google-analytics`. */
  id: string;
  /** What to show a person, e.g. `Google Analytics`. */
  name: string;
  category: TechnologyCategory;
  /** 0..1, rounded to two places. */
  confidence: number;
  /** Every marker that fired, verbatim, for §11's report. */
  signals: string[];
  /** Only when the page states it. Never inferred from a URL shape. */
  version?: string;
}

/** Where a font came from. `computed` is the only one needing a live DOM. */
export type FontOriginKind =
  'font-face' | 'stylesheet-link' | 'font-service' | 'inline-style' | 'computed';

export interface FontOrigin {
  kind: FontOriginKind;
  /** Absolute, when the origin names a file or a stylesheet. */
  url?: string;
  /** The service that serves it, when it is a known one. */
  service?: string;
}

export interface FontFamily {
  /** As written, minus quotes. `Vazirmatn`, not `vazirmatn`. */
  family: string;
  /** `400`, `700`, `normal`, `bold` — as the stylesheet asked for them. */
  weights: string[];
  /** `normal`, `italic`, `oblique`. */
  styles: string[];
  origins: FontOrigin[];
  /**
   * Selectors seen using this family. Only ever populated from
   * `InspectFontsOptions.computed`, because a stylesheet does not say which
   * elements matched it.
   */
  usedBy?: string[];
}

/**
 * Font facts that need a live DOM, supplied by a surface that has one.
 *
 * The extension has a real page and can read `getComputedStyle`; `core` runs
 * against a parsed string and cannot. Rather than have the extension implement
 * its own font logic — which the app would then need again — it measures, and
 * hands the measurements in here.
 */
export interface ComputedFontUsage {
  /** A CSS selector, or any label identifying the elements measured. */
  selector: string;
  /** The resolved family, first in the stack, unquoted. */
  family: string;
  weight?: string;
  style?: string;
}

export interface InspectFontsOptions {
  computed?: readonly ComputedFontUsage[];
}

/** Which piece of markup referenced an image. */
export type ImageOriginKind = 'img' | 'srcset' | 'source' | 'css-background' | 'preload' | 'icon';

export interface ImageAsset {
  /** Absolute. Resolved against the document URL. */
  url: string;
  /** Every kind of markup that referenced it, de-duplicated. */
  origins: ImageOriginKind[];
  /** From `width`/`height` attributes only — never measured, never fetched. */
  width?: number;
  height?: number;
  /** First non-empty `alt` seen for this URL. */
  alt?: string;
  /** `srcset` descriptors this URL appeared under, e.g. `2x`, `640w`. */
  descriptors?: string[];
}

/** Everything the inspector can say about one document. */
export interface PageInspection {
  url: string;
  technologies: Technology[];
  fonts: FontFamily[];
  images: ImageAsset[];
}
