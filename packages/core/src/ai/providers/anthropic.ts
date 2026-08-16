/**
 * Claude, via the Messages API structured-output mode.
 *
 * **Why raw HTTP rather than `@anthropic-ai/sdk`.** Everywhere else this
 * project reaches for the official client, and normally that is the right call.
 * Here it is not, for the same reason `extract/html.ts` uses `cheerio/slim`:
 * this code is bundled into an MV3 service worker. The vendor SDKs assume a
 * Node runtime (`node:stream`, `undici`, process-level env reads), and the
 * pipeline needs three vendors behind one interface — so the choice is one
 * `HttpClient` seam that already exists and is already faked in tests, or three
 * SDKs that between them cannot bundle. §12 also forbids live network in tests,
 * which the seam gives for free.
 *
 * Structured outputs rather than tool use: the answer is one object, and
 * `output_config.format` says exactly that without inventing a fictional tool
 * for the model to "call".
 */

import type { AIExtractInput, AIExtractResult, AIProvider } from '../types.js';
import { emptyUsage } from '../types.js';
import { buildPrompt, buildSchema, type JsonSchema } from '../schema.js';
import type { TargetField } from '../../config/types.js';
import {
  callProvider,
  failed,
  parseModelJson,
  usageNumber,
  type ProviderOptions,
} from './shared.js';

const DEFAULT_MODEL = 'claude-opus-5';
const API = 'https://api.anthropic.com/v1/messages';

/**
 * Small on purpose. One product's JSON is a few hundred tokens; the usual
 * 16k default exists to stop long prose being cut off mid-thought, which is
 * not a risk for a fixed-shape object, and a lower ceiling caps the damage
 * from a runaway answer on a page the trimmer handled badly.
 */
const MAX_TOKENS = 4096;

export interface AnthropicOptions extends ProviderOptions {
  /** Fields still missing, which narrows the schema. */
  missing?: readonly TargetField[];
}

export function createAnthropicProvider(options: AnthropicOptions): AIProvider {
  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: 'claude',
    model,
    async extract(input: AIExtractInput): Promise<AIExtractResult> {
      const schema: JsonSchema = buildSchema(
        options.missing ?? (input.targetFields as readonly TargetField[])
      );
      if (Object.keys(schema.properties ?? {}).length === 0) {
        return { fields: {}, usage: emptyUsage('claude', model), issues: [] };
      }

      const body = {
        model,
        max_tokens: MAX_TOKENS,
        system: buildPrompt(input.targetFields, input.locale),
        output_config: { format: { type: 'json_schema', schema } },
        messages: [
          {
            role: 'user',
            content: `Product page HTML:\n\n${input.htmlFragment}`,
          },
        ],
      };

      const outcome = await callProvider(
        'Claude',
        model,
        options.client,
        {
          url: options.baseUrl ?? API,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        (parsed) => {
          const record = parsed as Record<string, unknown>;
          const usage = emptyUsage('claude', model);
          usage.inputTokens = usageNumber(record['usage'], 'input_tokens');
          usage.outputTokens = usageNumber(record['usage'], 'output_tokens');

          // A refusal is a successful HTTP response with no content to read.
          // Reporting it as an empty answer is accurate and keeps the scan
          // going; there is nothing here for the user to fix.
          const content = record['content'];
          if (!Array.isArray(content)) return { usage };
          const text = content
            .filter(
              (block): block is { type: string; text: string } =>
                typeof block === 'object' &&
                block !== null &&
                (block as { type?: unknown }).type === 'text' &&
                typeof (block as { text?: unknown }).text === 'string'
            )
            .map((block) => block.text)
            .join('');
          return { text, usage };
        }
      );

      if (outcome.text === undefined) {
        return failed(
          outcome.usage,
          outcome.failure ?? 'Claude returned nothing.',
          input.sourceUrl
        );
      }
      const answer = parseModelJson(outcome.text);
      if (answer === undefined) {
        return failed(outcome.usage, 'Claude’s answer was not valid JSON.', input.sourceUrl);
      }
      return { fields: answer, usage: outcome.usage, issues: [] };
    },
  };
}
