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
  /**
   * Everything currently in `chrome.storage.session`.
   *
   * Separate from `store` on purpose: §17 says the bridge token is never
   * persisted, and the way to assert that is to check it is in this map and
   * not in the one that survives a browser restart.
   */
  readonly sessionStore: Map<string, unknown>;
  /** Origin patterns the user has granted. */
  readonly granted: Set<string>;
  /** Whether the next `permissions.request` is accepted. */
  grant: boolean;
  restore(): void;
}

/** One storage area over one map; `local` and `session` differ only in which. */
function fakeArea(store: Map<string, unknown>) {
  return {
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
  };
}

export function installFakeChrome(): FakeChrome {
  const store = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();
  const granted = new Set<string>();

  const fake = {
    storage: {
      local: fakeArea(store),
      session: fakeArea(sessionStore),
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
    sessionStore,
    granted,
    grant: true,
    restore() {
      if (previous === undefined) delete globals['chrome'];
      else globals['chrome'] = previous;
    },
  };

  return handle;
}
