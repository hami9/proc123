/**
 * The strict JSON schema every provider is held to.
 *
 * CLAUDE.md §4: "Use each provider's structured-output / function-calling mode
 * with a strict JSON schema." One schema, built here, translated by each
 * provider adapter into its own dialect — rather than three hand-written
 * schemas that drift apart and produce three differently-shaped answers for
 * `verify.ts` to untangle.
 *
 * Two decisions worth stating, both forced by strict mode rather than chosen:
 *
 * - **Every property is required, and nullable.** OpenAI's `strict: true`
 *   rejects a schema whose `required` list is not exhaustive, so "optional" has
 *   to be spelled as "required, may be null". That happens to be the better
 *   contract anyway: an explicit `null` means "I looked and it is not there",
 *   which is a different and more useful answer than a missing key.
 * - **Only requested fields appear.** The schema is generated per scan from
 *   `targetFields`, so a field the user turned off is not in the schema, not in
 *   the prompt, and not something the model is invited to invent.
 */

import { FIELD_PROPERTIES, type TargetField } from '../config/types.js';

/** A JSON Schema fragment. Loose on purpose — each provider narrows it. */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

function nullable(schema: JsonSchema): JsonSchema {
  const type = schema.type;
  if (typeof type === 'string') return { ...schema, type: [type, 'null'] };
  return schema;
}

const MONEY: JsonSchema = {
  type: 'object',
  description: 'A price exactly as printed on the page. Never convert, round, or compute a value.',
  properties: {
    amount: {
      type: 'number',
      description: 'The numeric amount, with grouping separators removed.',
    },
    currency: {
      type: 'string',
      description: 'ISO 4217 code, e.g. IRR or USD. Use IRR for تومان and ریال.',
    },
    unit: {
      type: ['string', 'null'],
      enum: ['toman', 'rial'],
      description:
        'Only for IRR. "toman" if the page says تومان, "rial" if it says ریال. ' +
        'Null if the page does not say which — do not guess, the two differ by 10x.',
    },
  },
  required: ['amount', 'currency', 'unit'],
  additionalProperties: false,
};

const ATTRIBUTE: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The attribute label as printed, e.g. رنگ or Size.' },
    values: {
      type: 'array',
      items: { type: 'string' },
      description: 'Every option offered for this attribute, as printed.',
    },
  },
  required: ['name', 'values'],
  additionalProperties: false,
};

/** One entry per `CanonicalProduct` property Layer D is allowed to fill. */
const PROPERTY_SCHEMAS: Record<string, JsonSchema> = {
  name: { type: 'string', description: 'The product title, exactly as printed.' },
  sku: { type: 'string', description: 'The product code, if the page prints one.' },
  description: {
    type: 'string',
    description: 'The main product description, as plain text.',
  },
  shortDescription: { type: 'string', description: 'The summary or excerpt, if separate.' },
  regularPrice: MONEY,
  salePrice: {
    ...MONEY,
    description:
      'The discounted price, only when the page shows both a struck-through original ' +
      'and a current price. Null when the product is not on sale.',
  },
  categoryPath: {
    type: 'array',
    items: { type: 'string' },
    description:
      'The category trail from the breadcrumb, outermost first, e.g. ["آجیل", "گردو"]. ' +
      'Exclude the product name itself and any "Home" link.',
  },
  images: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Image URLs of this product, copied exactly as they appear in the markup. ' +
      'Do not include logos, icons, or images of other products.',
  },
  attributes: { type: 'array', items: ATTRIBUTE },
  tags: { type: 'array', items: { type: 'string' } },
  inStock: {
    type: 'boolean',
    description: 'True if the page says the product can be bought now.',
  },
  stockQuantity: {
    type: 'integer',
    description: 'Only when the page prints an exact number in stock.',
  },
  brand: { type: 'string' },
  gtin: { type: 'string', description: 'A barcode number: EAN, UPC, or ISBN.' },
};

/**
 * Build the schema for one call.
 *
 * `missing` narrows it further than `targetFields` does: there is no reason to
 * ask for a name that Layer B already read. Asking anyway costs tokens and
 * invites the model to disagree with a value we trust more than its answer.
 */
export function buildSchema(missing: readonly TargetField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const field of missing) {
    for (const property of FIELD_PROPERTIES[field] ?? []) {
      const schema = PROPERTY_SCHEMAS[property];
      if (schema !== undefined) properties[property] = nullable(schema);
    }
  }

  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/**
 * Gemini's `responseSchema` is OpenAPI-flavoured and rejects some JSON Schema
 * keywords outright. Stripping them is safe: they constrain the answer, and
 * `verify.ts` re-checks everything they would have enforced.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  delete out.additionalProperties;

  if (Array.isArray(out.type)) {
    // Gemini expresses "may be absent" with `nullable`, not a type union.
    const concrete = out.type.find((entry) => entry !== 'null');
    out.type = concrete ?? 'string';
    if (out.type !== concrete || out.type.length > 0) out['nullable'] = true;
  }
  if (out.properties !== undefined) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(out.properties)) {
      properties[key] = toGeminiSchema(value);
    }
    out.properties = properties;
  }
  if (out.items !== undefined) out.items = toGeminiSchema(out.items);
  return out;
}

/**
 * The instruction sent alongside the schema.
 *
 * Short, and every line of it is a guard against a specific failure seen in
 * this domain: reading the neighbour's price out of a carousel, converting
 * toman to rial helpfully, and filling a blank with something reasonable.
 */
export function buildPrompt(fields: readonly string[], locale?: string): string {
  const lines = [
    'You are reading one product page from an online shop and reporting what it says.',
    '',
    'Rules:',
    '1. Report only what is written in the HTML provided. If a value is not there, return null.',
    '2. Never calculate, convert, round, or estimate. Copy values as printed.',
    '3. The page may mention other products (related items, recently viewed).',
    '   Report only the product this page is about.',
    '4. Do not translate. Keep the original language and script.',
    '',
    `Fields wanted: ${fields.join(', ')}.`,
  ];
  if (locale !== undefined && locale.trim() !== '') {
    lines.push(`The page declares its language as ${locale}.`);
  }
  return lines.join('\n');
}
