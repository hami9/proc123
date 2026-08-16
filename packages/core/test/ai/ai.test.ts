/**
 * Layer D — the AI fallback.
 *
 * The tests that matter here are the ones about restraint rather than
 * capability: that the layer does not run when the markup already answered,
 * that it never sends the whole page, and above all that it refuses to believe
 * a value it cannot find in what it sent. A model is perfectly capable of
 * returning a well-formed, plausible, invented price; everything below exists
 * to make sure that price does not reach a CSV.
 *
 * No live network anywhere (CLAUDE.md §12) — every provider is driven by a
 * canned `HttpClient`.
 */

import { describe, expect, it } from 'vitest';

import {
  AI_CONFIDENCE,
  type AIProvider,
  type CanonicalProduct,
  DEFAULT_CONFIG,
  type HttpClient,
  type HttpRequest,
  type Proc123Config,
  buildPrompt,
  buildSchema,
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAIProvider,
  createProvider,
  enrichWithAI,
  missingTier1For,
  needsAI,
  toGeminiSchema,
  trimFragment,
  verifyAnswer,
} from '@proc123/core';

const SCANNED_AT = '2026-08-16T09:00:00.000Z';
const PAGE_URL = 'https://ajil.example/p/walnut';

/**
 * A realistic product page: the product itself, plus every kind of thing that
 * has to be trimmed away — inline script, site chrome, and a related-products
 * carousel carrying a *different* real price. That last one is the trap; a
 * model shown the whole page will read `۹۸,۰۰۰` as often as not.
 */
const PAGE_HTML = `<!doctype html>
<html lang="fa">
  <head>
    <title>گردو</title>
    <script>window.dataLayer = [{"price": 777777}];</script>
    <style>.price { color: red }</style>
  </head>
  <body>
    <header class="site-header"><a href="/">فروشگاه</a></header>
    <nav class="menu-main"><a href="/c/nuts">آجیل</a></nav>
    <main>
      <nav class="breadcrumb"><a href="/">خانه</a> / <a href="/c/nuts">آجیل</a> / <span>گردو</span></nav>
      <article class="product-detail" data-product-id="42">
        <h1 class="product-title">گردو با پوست</h1>
        <div class="price"><span class="amount">۱۵۰,۰۰۰</span> تومان</div>
        <img src="/img/walnut.jpg" alt="گردو" />
        <div class="stock">موجود در انبار</div>
        <div class="description">گردوی تازه از سال جاری.</div>
      </article>
      <section class="related-products">
        <h2>محصولات مرتبط</h2>
        <div class="product"><h3>بادام</h3><span class="amount">۹۸,۰۰۰</span> تومان</div>
      </section>
    </main>
    <footer class="site-footer">© فروشگاه</footer>
  </body>
</html>`;

function product(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    sourceUrl: PAGE_URL,
    kind: 'simple',
    name: 'گردو با پوست',
    categoryPath: ['آجیل'],
    images: [],
    attributes: [],
    inStock: true,
    description: 'گردوی تازه از سال جاری.',
    extractionMeta: { layer: 'B', fieldConfidence: { name: 0.95 }, scannedAt: SCANNED_AT },
    ...overrides,
  };
}

const config = (over: Partial<Proc123Config> = {}): Proc123Config => ({
  ...DEFAULT_CONFIG,
  ...over,
  aiProvider: { ...DEFAULT_CONFIG.aiProvider, enabled: true, ...over.aiProvider },
});

/** A provider that answers with whatever it is handed, and counts calls. */
function cannedProvider(
  answer: Record<string, unknown>
): AIProvider & { calls: number; lastFragment: string | undefined } {
  const provider = {
    name: 'canned',
    model: 'test-1',
    calls: 0,
    lastFragment: undefined as string | undefined,
    extract(input: { htmlFragment: string }) {
      provider.calls += 1;
      provider.lastFragment = input.htmlFragment;
      return Promise.resolve({
        fields: answer,
        usage: {
          provider: 'canned',
          model: 'test-1',
          requests: 1,
          inputTokens: 1200,
          outputTokens: 80,
        },
        issues: [],
      });
    },
  };
  return provider;
}

/** An `HttpClient` that replays one canned response and records the request. */
function cannedHttp(response: { status?: number; body: string }, seen: HttpRequest[]): HttpClient {
  return (request) => {
    seen.push(request);
    return Promise.resolve({
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
      body: response.body,
    });
  };
}

describe('trimFragment', () => {
  it('keeps the product and drops the page furniture', () => {
    const trimmed = trimFragment(PAGE_HTML);

    expect(trimmed.html).toContain('گردو با پوست');
    expect(trimmed.html).toContain('۱۵۰,۰۰۰');
    expect(trimmed.html).toContain('/img/walnut.jpg');

    expect(trimmed.html).not.toContain('dataLayer');
    expect(trimmed.html).not.toContain('777777');
    expect(trimmed.html).not.toContain('color: red');
    expect(trimmed.html).not.toContain('© فروشگاه');
  });

  it('drops a related-products carousel, so its price cannot be misread', () => {
    const trimmed = trimFragment(PAGE_HTML);

    expect(trimmed.html).not.toContain('بادام');
    expect(trimmed.html).not.toContain('۹۸,۰۰۰');
  });

  it('keeps a breadcrumb but still drops the menu', () => {
    const trimmed = trimFragment(PAGE_HTML);

    // Categories are Tier 1 and are one of the things that opens the AI gate;
    // the breadcrumb is usually the only place the trail is written.
    expect(trimmed.html).toContain('breadcrumb');
    expect(trimmed.html).toContain('آجیل');
    expect(trimmed.html).not.toContain('menu-main');
    expect(trimmed.html).not.toContain('فروشگاه');
  });

  it('sends a small fraction of the page', () => {
    const trimmed = trimFragment(PAGE_HTML);

    expect(trimmed.sourceChars).toBe(PAGE_HTML.length);
    expect(trimmed.html.length).toBeLessThan(PAGE_HTML.length / 2);
  });

  it('strips attributes that are pure cost and keeps the ones that carry meaning', () => {
    const trimmed = trimFragment(
      '<main><div class="price" style="color:red" onclick="x()" data-gtm-id="abc123" data-price="150000">۱۵۰,۰۰۰</div></main>'
    );

    expect(trimmed.html).toContain('class="price"');
    expect(trimmed.html).toContain('data-price="150000"');
    expect(trimmed.html).not.toContain('onclick');
    expect(trimmed.html).not.toContain('style=');
    expect(trimmed.html).not.toContain('data-gtm-id');
  });

  it('reports truncation rather than silently sending a clipped page', () => {
    const long = `<main><p>${'گردو '.repeat(4000)}</p></main>`;
    const trimmed = trimFragment(long, { maxChars: 500 });

    expect(trimmed.truncated).toBe(true);
    expect(trimmed.html.length).toBeLessThanOrEqual(600);
  });

  it('yields nothing for markup it cannot make sense of', () => {
    expect(trimFragment('').html).toBe('');
  });
});

describe('the Tier-1 gate', () => {
  it('does not fire when the markup already answered', () => {
    const complete = product({
      regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' },
      images: ['https://cdn.example/w.jpg'],
      categoryPath: ['آجیل', 'گردو'],
    });

    expect(needsAI(complete, DEFAULT_CONFIG.targetFields)).toBe(false);
  });

  it('fires when a Tier-1 field is still empty', () => {
    const missingPrice = product({ images: ['x'], categoryPath: ['آجیل'] });

    expect(needsAI(missingPrice, DEFAULT_CONFIG.targetFields)).toBe(true);
    expect(missingTier1For(missingPrice, DEFAULT_CONFIG.targetFields)).toContain('regularPrice');
  });

  it('ignores a field the user turned off', () => {
    const noPrice = product({ images: ['x'] });
    const wanted = DEFAULT_CONFIG.targetFields.filter(
      (field) => field !== 'regularPrice' && field !== 'images'
    );

    expect(missingTier1For(noPrice, wanted)).not.toContain('regularPrice');
  });

  it('never sends a variation on its own', () => {
    const variation = product({ kind: 'variation', parentSku: 'P-1', images: [] });

    expect(needsAI(variation, DEFAULT_CONFIG.targetFields)).toBe(false);
  });

  it('treats a missing sale price as normal, not as incomplete', () => {
    const onlyRegular = product({
      regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' },
      images: ['x'],
      categoryPath: ['آجیل'],
    });

    expect(missingTier1For(onlyRegular, DEFAULT_CONFIG.targetFields)).toEqual([]);
  });
});

describe('verifyAnswer', () => {
  const fragment = trimFragment(PAGE_HTML).html;
  const context = { fragment, sourceUrl: PAGE_URL, wanted: DEFAULT_CONFIG.targetFields };

  it('accepts a price that is printed on the page', () => {
    const result = verifyAnswer(
      { regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' } },
      context
    );

    expect(result.fields.regularPrice).toEqual({
      amount: 150_000,
      currency: 'IRR',
      unit: 'toman',
    });
    expect(result.rejected).toBe(0);
  });

  it('rejects a price that is not', () => {
    const result = verifyAnswer(
      { regularPrice: { amount: 249_000, currency: 'IRR', unit: 'toman' } },
      context
    );

    expect(result.fields.regularPrice).toBeUndefined();
    expect(result.rejected).toBe(1);
    expect(result.issues[0]?.code).toBe('ai-value-not-on-page');
  });

  it('accepts the rial spelling of a price the page quotes in toman', () => {
    const result = verifyAnswer(
      { regularPrice: { amount: 1_500_000, currency: 'IRR', unit: 'rial' } },
      context
    );

    expect(result.fields.regularPrice?.amount).toBe(1_500_000);
  });

  it('keeps an image that is in the markup and drops one that is not', () => {
    const result = verifyAnswer(
      { images: ['/img/walnut.jpg', 'https://cdn.example/invented.jpg'] },
      context
    );

    expect(result.fields.images).toEqual(['https://ajil.example/img/walnut.jpg']);
    expect(result.rejected).toBe(1);
  });

  it('never accepts a data URI', () => {
    const result = verifyAnswer({ images: ['data:image/png;base64,AAAA'] }, context);

    expect(result.fields.images).toBeUndefined();
  });

  it('ignores fields the user did not ask for', () => {
    const result = verifyAnswer(
      { gtin: '1234567890123', name: 'گردو با پوست' },
      { ...context, wanted: ['name'] }
    );

    expect(result.fields.name).toBe('گردو با پوست');
    expect(result.fields.gtin).toBeUndefined();
  });

  it('will not let Layer D decide which attribute is a variation axis', () => {
    const result = verifyAnswer(
      { attributes: [{ name: 'وزن', values: ['۵۰۰ گرم'], isVariationAxis: true }] },
      {
        ...context,
        fragment: `${fragment}<div>وزن: ۵۰۰ گرم</div>`,
      }
    );

    expect(result.fields.attributes?.[0]?.isVariationAxis).toBe(false);
  });

  it('drops a category segment that appears nowhere on the page', () => {
    const result = verifyAnswer({ categoryPath: ['آجیل', 'خشکبار وارداتی'] }, context);

    expect(result.fields.categoryPath).toEqual(['آجیل']);
  });
});

describe('enrichWithAI', () => {
  const page = { url: PAGE_URL, html: PAGE_HTML, locale: 'fa-IR' };

  it('does nothing when the provider is switched off', async () => {
    const provider = cannedProvider({ regularPrice: { amount: 150_000, currency: 'IRR' } });
    const result = await enrichWithAI([product()], page, provider, {
      ...DEFAULT_CONFIG,
      aiProvider: { ...DEFAULT_CONFIG.aiProvider, enabled: false },
    });

    expect(provider.calls).toBe(0);
    expect(result.requested).toBe(0);
  });

  it('does nothing when nothing is missing', async () => {
    const provider = cannedProvider({});
    const complete = product({
      regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' },
      images: ['https://cdn.example/w.jpg'],
      categoryPath: ['آجیل', 'گردو'],
    });

    const result = await enrichWithAI([complete], page, provider, config());

    expect(provider.calls).toBe(0);
    expect(result.usage.requests).toBe(0);
  });

  it('fills an empty field and records where the value came from', async () => {
    const provider = cannedProvider({
      regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' },
      images: ['/img/walnut.jpg'],
    });

    const result = await enrichWithAI([product()], page, provider, config());
    const filled = result.products[0];

    expect(filled?.regularPrice?.amount).toBe(150_000);
    expect(filled?.images).toEqual(['https://ajil.example/img/walnut.jpg']);
    expect(filled?.extractionMeta.fieldConfidence['regularPrice']).toBe(AI_CONFIDENCE);
    expect(filled?.extractionMeta.layer).toBe('D');
  });

  it('never overwrites a value another layer already found', async () => {
    const provider = cannedProvider({ name: 'گردو با پوست' });
    const withName = product({
      name: 'گردوی ایرانی',
      regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' },
      images: ['x'],
    });

    const result = await enrichWithAI([withName], page, provider, config());

    expect(result.products[0]?.name).toBe('گردوی ایرانی');
    expect(result.products[0]?.extractionMeta.layer).toBe('B');
  });

  it('sends a trimmed fragment, never the page', async () => {
    const provider = cannedProvider({});
    await enrichWithAI([product()], page, provider, config());

    expect(provider.lastFragment).toBeDefined();
    expect(provider.lastFragment).not.toContain('dataLayer');
    expect(provider.lastFragment?.length ?? 0).toBeLessThan(PAGE_HTML.length);
  });

  it('reports token usage for the scan', async () => {
    const provider = cannedProvider({ regularPrice: { amount: 150_000, currency: 'IRR' } });
    const result = await enrichWithAI([product()], page, provider, config());

    expect(result.usage.inputTokens).toBe(1200);
    expect(result.usage.outputTokens).toBe(80);
    const usage = result.issues.find((issue) => issue.code === 'ai-usage');
    expect(usage?.message).toContain('1200 input');
  });

  it('discards an invented price and says so', async () => {
    const provider = cannedProvider({
      regularPrice: { amount: 249_000, currency: 'IRR', unit: 'toman' },
    });

    const result = await enrichWithAI([product()], page, provider, config());

    expect(result.products[0]?.regularPrice).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === 'ai-value-not-on-page')).toBe(true);
  });

  it('skips the call entirely when no fragment can be isolated', async () => {
    const provider = cannedProvider({});
    const result = await enrichWithAI([product()], { url: PAGE_URL, html: '' }, provider, config());

    expect(provider.calls).toBe(0);
    expect(result.issues.some((issue) => issue.code === 'ai-no-fragment')).toBe(true);
  });
});

describe('the strict schema', () => {
  it('asks only for the fields that are missing', () => {
    const schema = buildSchema(['regularPrice', 'images']);

    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['images', 'regularPrice']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('marks every property required, as strict mode demands', () => {
    const schema = buildSchema(['name', 'regularPrice', 'stock']);

    expect(schema.required?.sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
  });

  it('translates into Gemini’s dialect without keywords it rejects', () => {
    const gemini = toGeminiSchema(buildSchema(['name', 'regularPrice']));

    expect(gemini.additionalProperties).toBeUndefined();
    expect(gemini.properties?.['name']?.type).toBe('string');
    expect(gemini.properties?.['name']?.['nullable']).toBe(true);
    expect(gemini.properties?.['regularPrice']?.additionalProperties).toBeUndefined();
  });

  it('tells the model not to convert between toman and rial', () => {
    expect(buildPrompt(['regularPrice'])).toContain('Never calculate, convert');
  });
});

describe('providers', () => {
  const input = {
    htmlFragment: '<main>۱۵۰,۰۰۰ تومان</main>',
    targetFields: ['regularPrice'],
    sourceUrl: PAGE_URL,
  };

  it('reads Claude’s answer and its token usage', async () => {
    const seen: HttpRequest[] = [];
    const provider = createAnthropicProvider({
      apiKey: 'sk-test',
      client: cannedHttp(
        {
          body: JSON.stringify({
            content: [
              { type: 'text', text: '{"regularPrice":{"amount":150000,"currency":"IRR"}}' },
            ],
            usage: { input_tokens: 900, output_tokens: 40 },
          }),
        },
        seen
      ),
    });

    const result = await provider.extract(input);

    expect(provider.model).toBe('claude-opus-5');
    expect(result.fields['regularPrice']).toEqual({ amount: 150_000, currency: 'IRR' });
    expect(result.usage.inputTokens).toBe(900);
    expect(result.usage.outputTokens).toBe(40);

    const body = JSON.parse(seen[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['output_config']).toMatchObject({ format: { type: 'json_schema' } });
    expect(seen[0]?.headers?.['x-api-key']).toBe('sk-test');
    expect(seen[0]?.headers?.['anthropic-version']).toBe('2023-06-01');
  });

  it('reads OpenAI’s answer and enforces strict mode', async () => {
    const seen: HttpRequest[] = [];
    const provider = createOpenAIProvider({
      apiKey: 'sk-test',
      client: cannedHttp(
        {
          body: JSON.stringify({
            choices: [
              { message: { content: '{"regularPrice":{"amount":150000,"currency":"IRR"}}' } },
            ],
            usage: { prompt_tokens: 800, completion_tokens: 30 },
          }),
        },
        seen
      ),
    });

    const result = await provider.extract(input);

    expect(result.usage.inputTokens).toBe(800);
    const body = JSON.parse(seen[0]?.body ?? '{}') as {
      response_format?: { json_schema?: { strict?: boolean } };
    };
    expect(body.response_format?.json_schema?.strict).toBe(true);
  });

  it('reads Gemini’s answer and keeps the key out of the URL', async () => {
    const seen: HttpRequest[] = [];
    const provider = createGeminiProvider({
      apiKey: 'AIza-test',
      client: cannedHttp(
        {
          body: JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"regularPrice":{"amount":150000,"currency":"IRR"}}' }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 25 },
          }),
        },
        seen
      ),
    });

    const result = await provider.extract(input);

    expect(result.usage.inputTokens).toBe(700);
    expect(seen[0]?.url).not.toContain('AIza-test');
    expect(seen[0]?.headers?.['x-goog-api-key']).toBe('AIza-test');
  });

  it('treats a vendor rate limit as an AI problem, not as the shop blocking us', async () => {
    const seen: HttpRequest[] = [];
    const provider = createAnthropicProvider({
      apiKey: 'sk-test',
      client: cannedHttp({ status: 429, body: '{"error":"rate_limit"}' }, seen),
    });

    const result = await provider.extract(input);

    expect(result.fields).toEqual({});
    expect(result.issues[0]?.kind).toBe('ai-failed');
    expect(result.issues[0]?.message).toContain('not the shop blocking us');
    expect(result.usage.requests).toBe(1);
  });

  it('says plainly when the key is refused', async () => {
    const provider = createOpenAIProvider({
      apiKey: 'bad',
      client: cannedHttp({ status: 401, body: '{"error":"invalid_api_key"}' }, []),
    });

    const result = await provider.extract(input);

    expect(result.issues[0]?.message).toContain('Check the key in settings');
  });

  it('survives an answer that is not JSON', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      client: cannedHttp(
        { body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'sorry!' }] } }] }) },
        []
      ),
    });

    const result = await provider.extract(input);

    expect(result.fields).toEqual({});
    expect(result.issues[0]?.kind).toBe('ai-failed');
  });

  it('recovers an answer a provider wrapped in a code fence', async () => {
    const provider = createOpenAIProvider({
      apiKey: 'k',
      client: cannedHttp(
        {
          body: JSON.stringify({
            choices: [{ message: { content: '```json\n{"name":"گردو"}\n```' } }],
          }),
        },
        []
      ),
    });

    const result = await provider.extract({ ...input, targetFields: ['name'] });

    expect(result.fields['name']).toBe('گردو');
  });

  it('refuses to build a provider without a key', () => {
    const client: HttpClient = () => Promise.resolve({ status: 200, headers: {}, body: '{}' });

    expect(createProvider({ name: 'claude', apiKey: '', client })).toBeUndefined();
    expect(createProvider({ name: 'nonesuch', apiKey: 'k', client })).toBeUndefined();
    expect(createProvider({ name: 'gemini', apiKey: 'k', client })?.name).toBe('gemini');
  });
});
