/**
 * OpenAI, via `response_format: json_schema` in strict mode.
 *
 * Strict mode is what makes the schema in `schema.ts` binding rather than
 * advisory, and it is why every property there is required-and-nullable: strict
 * mode rejects a schema whose `required` list is not exhaustive.
 *
 * Raw HTTP for the reason given in `anthropic.ts` — this bundles into an MV3
 * service worker, and one shared `HttpClient` seam is what keeps three vendors
 * behind one interface and out of the network in tests.
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

const DEFAULT_MODEL = 'gpt-4.1-mini';
const API = 'https://api.openai.com/v1/chat/completions';

export interface OpenAIOptions extends ProviderOptions {
  missing?: readonly TargetField[];
  /** Sent as `OpenAI-Organization` when the key belongs to several. */
  organization?: string;
}

export function createOpenAIProvider(options: OpenAIOptions): AIProvider {
  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: 'openai',
    model,
    async extract(input: AIExtractInput): Promise<AIExtractResult> {
      const schema: JsonSchema = buildSchema(
        options.missing ?? (input.targetFields as readonly TargetField[])
      );
      if (Object.keys(schema.properties ?? {}).length === 0) {
        return { fields: {}, usage: emptyUsage('openai', model), issues: [] };
      }

      const body = {
        model,
        messages: [
          { role: 'system', content: buildPrompt(input.targetFields, input.locale) },
          { role: 'user', content: `Product page HTML:\n\n${input.htmlFragment}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'product_fields', strict: true, schema },
        },
      };

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      };
      if (options.organization !== undefined) headers['openai-organization'] = options.organization;

      const outcome = await callProvider(
        'OpenAI',
        model,
        options.client,
        {
          url: options.baseUrl ?? API,
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        (parsed) => {
          const record = parsed as Record<string, unknown>;
          const usage = emptyUsage('openai', model);
          usage.inputTokens = usageNumber(record['usage'], 'prompt_tokens', 'input_tokens');
          usage.outputTokens = usageNumber(record['usage'], 'completion_tokens', 'output_tokens');

          const choices = record['choices'];
          if (!Array.isArray(choices) || choices.length === 0) return { usage };
          const message = (choices[0] as Record<string, unknown>)['message'];
          if (typeof message !== 'object' || message === null) return { usage };
          const content = (message as Record<string, unknown>)['content'];
          return { ...(typeof content === 'string' ? { text: content } : {}), usage };
        }
      );

      if (outcome.text === undefined) {
        return failed(
          outcome.usage,
          outcome.failure ?? 'OpenAI returned nothing.',
          input.sourceUrl
        );
      }
      const answer = parseModelJson(outcome.text);
      if (answer === undefined) {
        return failed(outcome.usage, 'OpenAI’s answer was not valid JSON.', input.sourceUrl);
      }
      return { fields: answer, usage: outcome.usage, issues: [] };
    },
  };
}
