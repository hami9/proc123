/**
 * Writing a file, through the native side.
 *
 * §15: the app can write directly to disk, which is one of the two things the
 * extension cannot do — the popup goes through a download prompt for every
 * export and a service worker cannot even make a blob URL.
 *
 * The *contents* are not this file's business. The exporter in
 * `packages/exporters` produces the text, headers, BOM and all, and it is
 * shared with the other two surfaces so every §7 rule has one home.
 */

interface TauriGlobal {
  core?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
}

/** Mirrors `SaveOutcome` in `src-tauri/src/files.rs`. */
export interface SaveOutcome {
  saved: boolean;
  path?: string;
}

/**
 * Ask where to put the file, then write it.
 *
 * A cancelled dialog comes back as `saved: false` rather than an error,
 * because declining a save dialog is an ordinary thing to do and not a failure
 * worth colouring red.
 */
export async function saveTextFile(suggestedName: string, contents: string): Promise<SaveOutcome> {
  const tauri = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core?.invoke;

  if (invoke === undefined) {
    throw new Error(
      'This build is running without its native host, so it cannot write files. ' +
        'Open the app itself rather than the front end in a browser.'
    );
  }

  return invoke<SaveOutcome>('save_text_file', { suggestedName, contents });
}
