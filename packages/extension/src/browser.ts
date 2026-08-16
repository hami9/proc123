/**
 * The one place that knows which browser this is running in.
 *
 * Chrome, Edge and Brave expose the extension API as `chrome`; Firefox exposes
 * it as `browser` and also aliases `chrome` for compatibility. The aliases are
 * not equivalent, though — historically Firefox's `chrome.*` used callbacks
 * while `browser.*` returned promises, and this codebase is `await`-shaped
 * throughout. Preferring `browser` when it exists is what makes one source tree
 * produce a working build for both.
 *
 * Everything else imports from here rather than touching a global, so adding a
 * third target later is an edit to this file instead of a search across seven.
 *
 * **Resolved per call, not once at import.** Binding the global at module load
 * looks tidier and is wrong twice over: it throws a `ReferenceError` merely for
 * *importing* one of these modules where neither global exists — which is every
 * test — and it captures whatever was there at load time, so a test that
 * installs a fake afterwards is talking to a stale object. A getter costs
 * nothing and removes both problems.
 *
 * `webextension-polyfill` would also solve the promise question. It is a
 * dependency, a bundle cost, and a shim over an API surface this project uses
 * six calls of — the comparison is not close.
 */

type ExtensionApi = typeof chrome;

interface ApiGlobals {
  browser?: ExtensionApi;
  chrome?: ExtensionApi;
}

function api(): ExtensionApi {
  const globals = globalThis as ApiGlobals;
  const found = globals.browser ?? globals.chrome;
  if (found === undefined) {
    throw new Error(
      'no extension API is available — this code only runs inside a browser extension'
    );
  }
  return found;
}

/** Re-exported so callers never have to name the `chrome` namespace either. */
export type Tab = chrome.tabs.Tab;

export const runtime = {
  get lastError(): typeof chrome.runtime.lastError {
    return api().runtime.lastError;
  },
  get onMessage(): typeof chrome.runtime.onMessage {
    return api().runtime.onMessage;
  },
  sendMessage<Request, Response>(message: Request): Promise<Response> {
    return api().runtime.sendMessage<Request, Response>(message);
  },
};

export const tabs = {
  query(query: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]> {
    return api().tabs.query(query);
  },
};

export const scripting = {
  executeScript: <Args extends unknown[], Result>(injection: {
    target: { tabId: number; allFrames?: boolean };
    func: (...args: Args) => Result;
    args?: Args;
  }): Promise<chrome.scripting.InjectionResult<Awaited<Result>>[]> =>
    api().scripting.executeScript(injection),
};

export const storage = {
  get local(): chrome.storage.StorageArea {
    return api().storage.local;
  },
};

export const permissions = {
  contains(request: chrome.permissions.Permissions): Promise<boolean> {
    return api().permissions.contains(request);
  },
  request(request: chrome.permissions.Permissions): Promise<boolean> {
    return api().permissions.request(request);
  },
};

/**
 * Which engine we are on, for the places that genuinely have to care.
 *
 * Never used for feature detection — "is this Firefox?" is the wrong question
 * when "does this API exist?" is answerable.
 */
export function isFirefox(): boolean {
  return (globalThis as ApiGlobals).browser !== undefined;
}
