/**
 * The executable entry point.
 *
 * Separate from `cli.ts` so the whole command can be tested without a process
 * to exit — `run` returns a code, and only this file acts on it.
 *
 * No top-level `await`: this same file is bundled as CommonJS for the
 * single-file executable (see `scripts/package.mjs`), and CJS has no such
 * thing. An async entry function costs three lines and works in both.
 */

import { run } from './cli.js';

async function main(): Promise<void> {
  const result = await run(process.argv.slice(2));
  process.exitCode = result.code;
}

main().catch((error: unknown) => {
  // Anything reaching here is a bug rather than a scan failure — `run` reports
  // those itself and returns a code.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
