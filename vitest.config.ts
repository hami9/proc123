import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Workspace packages are consumed straight from TypeScript source. Nothing
    // in packages/ emits to `dist` on install — the extension and the companion
    // each bundle from source at build time (see their `scripts/build.mjs`), so
    // there is never a stale compiled copy for tests to disagree with.
    alias: {
      '@proc123/core': pkg('core'),
      '@proc123/profiles': fileURLToPath(
        new URL('./packages/profiles/src/index.ts', import.meta.url)
      ),
      '@proc123/exporters': pkg('exporters'),
      '@proc123/companion': pkg('companion'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
