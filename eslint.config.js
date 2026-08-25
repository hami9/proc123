import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/*/test/fixtures/**',
      // Agent worktrees are checkouts of this same repository nested inside it.
      // They are gitignored, but ESLint walks the directory tree rather than
      // git, so without this a local `npm run check` lints a second copy of
      // every file — and lints it *without* the per-package overrides below,
      // because those are keyed on paths starting `packages/`. CI never sees
      // this, which is exactly what makes it worth pinning down here.
      '.claude/**',
      // Cargo's build directory, for the same reason: it is gitignored, but it
      // contains generated JavaScript that Tauri emits for its own use and that
      // nothing here wrote or can fix.
      '**/target/**',
      // Regenerated from tauri.conf.json on every build.
      'packages/app/src-tauri/gen/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md §3: no unjustified `any`. An explicit eslint-disable with a
      // reason is the "justified" escape hatch.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.config.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Build scripts are plain JS/ESM, so they are not part of the TypeScript
    // program and cannot be type-checked by the lint rules. They run in Node
    // and printing where the build went is the whole point of them.
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      // `disableTypeChecked` turns off the rules that need type information;
      // this one only needs a parser, so it stays on and demands annotations
      // that plain JavaScript cannot carry.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // A service worker has no UI of its own: its console is where a scan that
    // went wrong is diagnosed, and CLAUDE.md §14 asks the minimal extension to
    // log the product count outright.
    files: ['packages/extension/src/**'],
    rules: {
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    },
  },
  prettier
);
