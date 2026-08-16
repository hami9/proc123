/**
 * A `chrome` stand-in, so the extension's own logic can be tested in Node.
 *
 * Only the surface `src/chrome.d.ts` declares is faked, which keeps the two in
 * step: a test that needs something not declared there is a sign the extension
 * grew a dependency nobody wrote down.
 */

export interface FakeChrome {
  /** Everything currently in `chrome.storage.local`. */
  readonly store: Map<string, unknown>;
  /** Origin patterns the user has granted. */
  readonly granted: Set<string>;
  /** Whether the next `permissions.request` is accepted. */
  grant: boolean;
  restore(): void;
}

export function installFakeChrome(): FakeChrome {
  const store = new Map<string, unknown>();
  const granted = new Set<string>();

  const fake = {
    storage: {
      local: {
        get(keys: string | string[] | null): Promise<Record<string, unknown>> {
          const wanted = keys === null ? [...store.keys()] : [keys].flat();
          const out: Record<string, unknown> = {};
          for (const key of wanted) {
            if (store.has(key)) out[key] = store.get(key);
          }
          return Promise.resolve(out);
        },
        set(items: Record<string, unknown>): Promise<void> {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
          return Promise.resolve();
        },
        remove(keys: string | string[]): Promise<void> {
          for (const key of [keys].flat()) store.delete(key);
          return Promise.resolve();
        },
      },
    },
    permissions: {
      contains: ({ origins }: { origins?: string[] }): Promise<boolean> =>
        Promise.resolve((origins ?? []).every((origin) => granted.has(origin))),
      request: ({ origins }: { origins?: string[] }): Promise<boolean> => {
        if (!handle.grant) return Promise.resolve(false);
        for (const origin of origins ?? []) granted.add(origin);
        return Promise.resolve(true);
      },
    },
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = globals['chrome'];
  globals['chrome'] = fake;

  const handle: FakeChrome = {
    store,
    granted,
    grant: true,
    restore() {
      if (previous === undefined) delete globals['chrome'];
      else globals['chrome'] = previous;
    },
  };

  return handle;
}
