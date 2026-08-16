/**
 * A file-backed `CrawlStore`.
 *
 * The extension persists to `chrome.storage` because an MV3 worker is killed
 * when idle. The companion has the opposite problem and the same answer: a
 * long crawl of a large catalogue is exactly the thing a user will interrupt
 * with Ctrl-C, and being able to resume rather than start over is the whole
 * point of `CrawlState` (CLAUDE.md §10).
 *
 * One record per crawl, written atomically. A half-written state file is worse
 * than none: it fails to parse on the next run and takes the crawl with it, so
 * the write goes to a temporary file and is renamed into place — `rename` is
 * atomic on both Linux and Windows within a directory.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { CrawlState, CrawlStore } from '@proc123/core';

/**
 * Where state lives when the user has not said otherwise.
 *
 * `XDG_STATE_HOME` on Linux, `LOCALAPPDATA` on Windows, falling back to a dot
 * directory. Crawl state is resumable progress rather than configuration, which
 * is what the state directory is for.
 */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env['XDG_STATE_HOME'];
  if (xdg !== undefined && xdg !== '') return join(xdg, 'proc123');

  const local = env['LOCALAPPDATA'];
  if (local !== undefined && local !== '') return join(local, 'proc123', 'state');

  return join(homedir(), '.local', 'state', 'proc123');
}

/** Keeps a crawl id from escaping its directory, whatever it contains. */
function fileFor(dir: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return resolve(dir, `${safe}.json`);
}

export function createFileCrawlStore(dir: string = defaultStateDir()): CrawlStore {
  return {
    async load(id: string): Promise<CrawlState | undefined> {
      try {
        const raw = await readFile(fileFor(dir, id), 'utf8');
        return JSON.parse(raw) as CrawlState;
      } catch {
        // Missing or unreadable both mean "no crawl to resume", which is the
        // ordinary first-run case rather than a failure worth reporting.
        return undefined;
      }
    },

    async save(state: CrawlState): Promise<void> {
      const path = fileFor(dir, state.id);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${String(process.pid)}.tmp`;
      await writeFile(temporary, JSON.stringify(state), 'utf8');
      await rename(temporary, path);
    },

    async clear(id: string): Promise<void> {
      await rm(fileFor(dir, id), { force: true });
    },
  };
}
