/**
 * The slice of the Chrome extension API this extension actually uses.
 *
 * Declared here rather than pulled from `@types/chrome` on purpose. It is six
 * APIs, it documents the entire platform surface the project depends on in one
 * readable file, and — because the root `tsconfig` types apply to every package
 * — it keeps `chrome.*` from being reachable inside `core`, which has to stay
 * platform-neutral (CLAUDE.md §3).
 */

declare namespace chrome {
  namespace runtime {
    const lastError: { message?: string } | undefined;

    function sendMessage<Request, Response>(message: Request): Promise<Response>;

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: { tab?: { id?: number; url?: string } },
          sendResponse: (response: unknown) => void
          // Returning true keeps the channel open for an async response.
        ) => boolean | undefined | void
      ): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }
    function query(query: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result?: T;
      frameId: number;
    }
    /**
     * Chrome awaits a promise the injected function returns, so the result is
     * the resolved value — which is what lets the picker be async.
     */
    function executeScript<Args extends unknown[], Result>(injection: {
      target: { tabId: number; allFrames?: boolean };
      func: (...args: Args) => Result;
      args?: Args;
    }): Promise<InjectionResult<Awaited<Result>>[]>;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
    /** Memory only, cleared when the browser closes. Holds the bridge token. */
    const session: StorageArea;
  }

  namespace permissions {
    interface Permissions {
      permissions?: string[];
      origins?: string[];
    }
    function contains(permissions: Permissions): Promise<boolean>;
    /** Must be called from a user gesture, which is why the popup owns this. */
    function request(permissions: Permissions): Promise<boolean>;
  }

  namespace downloads {
    interface DownloadOptions {
      url: string;
      /** Relative to the downloads folder. Sub-folders are allowed. */
      filename?: string;
      /** `uniquify` rather than `overwrite`: never clobber someone's file. */
      conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
      saveAs?: boolean;
    }
    /**
     * Resolves with the download id once the download has *started*.
     *
     * The worker owns this rather than the popup, because a popup is destroyed
     * the moment it loses focus and a twenty-image download outlives it.
     */
    function download(options: DownloadOptions): Promise<number>;
  }
}
