/**
 * Picking a provider by name.
 *
 * The name comes from `proc123.config.json`; the key never does. §4 is explicit
 * that a key lives in extension settings, and `resolveConfig` reports one found
 * in a config file rather than using it — so the two arrive here from different
 * places by design, and this factory is where they finally meet.
 */

import type { AIProvider } from '../types.js';
import type { TargetField } from '../../config/types.js';
import type { ProviderOptions } from './shared.js';
import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAIProvider } from './openai.js';

export type { ProviderOptions } from './shared.js';
export { createAnthropicProvider } from './anthropic.js';
export { createGeminiProvider } from './gemini.js';
export { createOpenAIProvider } from './openai.js';
export { aiIssue, parseModelJson } from './shared.js';

export interface CreateProviderOptions extends ProviderOptions {
  /** Config's `aiProvider.name`. */
  name: string;
  missing?: readonly TargetField[];
}

/** Known names, for the settings panel to offer. */
export const PROVIDER_NAMES = ['gemini', 'openai', 'claude'] as const;

/**
 * Build the configured provider, or explain why not.
 *
 * Returns `undefined` rather than throwing for a missing key: "the user has not
 * pasted a key yet" is the normal state of a freshly installed extension, not
 * an error worth unwinding a scan for.
 */
export function createProvider(options: CreateProviderOptions): AIProvider | undefined {
  if (options.apiKey.trim() === '') return undefined;

  switch (options.name.toLowerCase()) {
    case 'claude':
    case 'anthropic':
      return createAnthropicProvider(options);
    case 'openai':
    case 'gpt':
      return createOpenAIProvider(options);
    case 'gemini':
    case 'google':
      return createGeminiProvider(options);
    default:
      return undefined;
  }
}
