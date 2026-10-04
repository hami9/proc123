import { build } from 'esbuild';
import { parse } from 'acorn';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { TextEncoder } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildOptions } from '../packages/app/scripts/build.mjs';

describe('older Android WebViews', () => {
  it('allows native IPC responses without opening browser network access', () => {
    const config = JSON.parse(
      readFileSync(new URL('../packages/app/src-tauri/tauri.conf.json', import.meta.url), 'utf8')
    );
    const directives = Object.fromEntries(
      config.app.security.csp.split(';').map((directive) => {
        const [name, ...sources] = directive.trim().split(/\s+/);
        return [name, sources];
      })
    );
    // Large native responses use Tauri's IPC fetch channel. Shop requests still
    // go through Rust; no arbitrary HTTP(S) origin belongs in connect-src.
    expect(directives['connect-src']).toEqual(["'self'", 'ipc:', 'http://ipc.localhost']);
    expect(directives['default-src']).toEqual(["'self'"]);
  });

  it('ships a full app bundle that parses as ES2020', async () => {
    expect(buildOptions.target).toContain('chrome81');
    const result = await build({
      ...buildOptions,
      write: false,
      sourcemap: false,
      logLevel: 'silent',
    });
    const script = result.outputFiles.find(
      (file) => file.path.endsWith('/app.js') || file.path.endsWith('\\app.js')
    );
    expect(script).toBeDefined();
    expect(() => parse(script.text, { ecmaVersion: 2020, sourceType: 'module' })).not.toThrow();
    // Syntax lowering does not supply DOM APIs introduced after WebView 81.
    expect(script.text).not.toMatch(/\.replaceChildren\s*\(/);
    // Prove the parser rejects the exact syntax that broke the physical S9.
    expect(() => parse('value ??= 1', { ecmaVersion: 2020 })).toThrow();
  });

  it('exports CSV without replaceAll or Array.at in the runtime', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../packages/exporters/src/index.ts', import.meta.url))],
      bundle: true,
      format: 'iife',
      globalName: 'legacyExports',
      platform: 'browser',
      target: buildOptions.target,
      write: false,
      logLevel: 'silent',
    });
    const sandbox = createContext({ TextEncoder });
    runInContext(
      'String.prototype.replaceAll = undefined; Array.prototype.at = undefined;',
      sandbox
    );
    runInContext(result.outputFiles[0].text, sandbox);
    expect(runInContext('legacyExports.escapeCsvField(\'say "hi", "bye"\')', sandbox)).toBe(
      '"say ""hi"", ""bye"""'
    );
    expect(runInContext("legacyExports.escapeMultiValue('nuts, seeds, fruit')", sandbox)).toBe(
      'nuts\\, seeds\\, fruit'
    );
    expect(runInContext("legacyExports.escapeDescription('a\\\\nb\\\\nc')", sandbox)).toBe(
      'a\\\\nb\\\\nc'
    );
    runInContext(
      `globalThis.product = ${JSON.stringify({
        sourceUrl: 'https://shop.example/almond',
        kind: 'simple',
        name: 'بادام "شور"',
        categoryPath: ['آجیل', 'مغزها'],
        images: [],
        attributes: [],
        regularPrice: { amount: 150000, currency: 'IRR', unit: 'toman' },
        extractionMeta: { layer: 'B', fieldConfidence: {}, scannedAt: '2026-10-04T00:00:00Z' },
      })}`,
      sandbox
    );
    expect(runInContext('legacyExports.exportShopifyCsv([product]).csv', sandbox)).toContain(
      'مغزها'
    );
    expect(
      runInContext('legacyExports.exportWooCommerceCsv([product], { bom: true }).csv', sandbox)
    ).toContain('بادام ""شور""');
    runInContext('product.categoryPath = []', sandbox);
    expect(() =>
      runInContext('legacyExports.exportShopifyCsv([product]).csv', sandbox)
    ).not.toThrow();
  });
});
