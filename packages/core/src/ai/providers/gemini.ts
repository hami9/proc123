/**
 * Gemini, via `generationConfig.responseSchema`.
 *
 * Gemini's schema dialect is OpenAPI-flavoured rather than JSON Schema: it
 * rejects `additionalProperties` and spells optionality as `nullable: true`
 * instead of a type union. `toGeminiSchema` does that translation, and dropping
 * the keywords it cannot express is safe because `verify.ts` re-checks
 * everything they would have constrained.
 *
 * The key goes in the `x-goog-api-key` header rather than the `?key=` query
 * parameter the quickstart shows. Same effect, except that a URL travels
 * through proxy logs, error reports and the extension's own debug output — and
 * this is the user's own paid key.
 *
 * Raw HTTP for the reason given in `anthropic.ts`.
 */

import type { AIExtractInput, AIExtractResult, AIProvider } from '../types.js';
import { emptyUsage } from '../types.js';
import { buildPrompt, buildSchema, toGeminiSchema } from '../schema.js';
import type { TargetField } from '../../config/types.js';
import {
  callProvider,
  failed,
  parseModelJson,
  usageNumber,
  type ProviderOptions,
} from './shared.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiOptions extends ProviderOptions {
  missing?: readonly TargetField[];
}

export function createGeminiProvider(options: GeminiOptions): AIProvider {
  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: 'gemini',
    model,
    async extract(input: AIExtractInput): Promise<AIExtractResult> {
      const schema = buildSchema(options.missing ?? (input.targetFields as readonly TargetField[]));
      if (Object.keys(schema.properties ?? {}).length === 0) {
        return { fields: {}, usage: emptyUsage('gemini', model), issues: [] };
      }

      const body = {
        systemInstruction: {
          parts: [{ text: buildPrompt(input.targetFields, input.locale) }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: `Product page HTML:\n\n${input.htmlFragment}` }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
        },
      };

      const url = options.baseUrl ?? `${API}/${encodeURIComponent(model)}:generateContent`;

      const outcome = await callProvider(
        'Gemini',
        model,
        options.client,
        {
          url,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': options.apiKey,
          },
          body: JSON.stringify(body),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        (parsed) => {
          const record = parsed as Record<string, unknown>;
          const usage = emptyUsage('gemini', model);
          usage.inputTokens = usageNumber(record['usageMetadata'], 'promptTokenCount');
          usage.outputTokens = usageNumber(record['usageMetadata'], 'candidatesTokenCount');

          const candidates = record['candidates'];
          if (!Array.isArray(candidates) || candidates.length === 0) return { usage };
          const content = (candidates[0] as Record<string, unknown>)['content'];
          if (typeof content !== 'object' || content === null) return { usage };
          const parts = (content as Record<string, unknown>)['parts'];
          if (!Array.isArray(parts)) return { usage };

          const text = parts
            .map((part) =>
              typeof part === 'object' &&
              part !== null &&
              typeof (part as { text?: unknown }).text === 'string'
                ? (part as { text: string }).text
                : ''
            )
            .join('');
          return { text, usage };
        }
      );

      if (outcome.text === undefined) {
        return failed(
          outcome.usage,
          outcome.failure ?? 'Gemini returned nothing.',
          input.sourceUrl
        );
      }
      const answer = parseModelJson(outcome.text);
      if (answer === undefined) {
        return failed(outcome.usage, 'Gemini’s answer was not valid JSON.', input.sourceUrl);
      }
      return { fields: answer, usage: outcome.usage, issues: [] };
    },
  };
}
