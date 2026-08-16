/**
 * Click-to-teach, running inside the page.
 *
 * This function is handed to `chrome.scripting.executeScript`, which serializes
 * it with `toString()` — so it must close over **nothing**. Every helper,
 * constant and style is inline, and that is why it reads more repetitively than
 * the rest of this codebase.
 *
 * It asks for three things and returns index paths rather than selectors.
 * Deriving a selector is `learnProfile`'s job in `core`, where it can be tested
 * and where it has the whole document to check uniqueness against; a picker
 * that guessed its own selectors would produce exactly the brittle `nth-child`
 * chains CLAUDE.md §4 warns about.
 */

export interface PickerResult {
  /** One index path per field asked for, in the order they were asked. */
  paths: number[][];
  cancelled: boolean;
}

/**
 * The steps the user is walked through. The product link is not among them —
 * `learnProfile` finds it from the title, so three clicks is all that is asked.
 */
export const PICKER_STEPS = ['name', 'regularPrice', 'image'] as const;

/**
 * Run the picker in the page. Returns when the user has picked everything or
 * pressed Escape.
 *
 * Written as a single self-contained function on purpose — see the file note.
 */
export function pickerScript(labels: string[]): Promise<PickerResult> {
  return new Promise<PickerResult>((resolve) => {
    const paths: number[][] = [];
    let step = 0;

    const banner = document.createElement('div');
    banner.setAttribute('data-proc123-ui', '');
    banner.style.cssText = [
      'position:fixed',
      'inset:0 0 auto 0',
      'z-index:2147483647',
      'padding:12px 16px',
      'background:#14110f',
      'color:#f2ede8',
      'font:14px/1.4 system-ui,sans-serif',
      'text-align:center',
      'box-shadow:0 2px 12px rgba(0,0,0,.35)',
      'pointer-events:none',
    ].join(';');

    const highlight = document.createElement('div');
    highlight.setAttribute('data-proc123-ui', '');
    highlight.style.cssText = [
      'position:fixed',
      'z-index:2147483646',
      'border:2px solid #e0956a',
      'background:rgba(224,149,106,.18)',
      'border-radius:3px',
      'pointer-events:none',
      'transition:all .05s ease-out',
      'display:none',
    ].join(';');

    document.body.append(banner, highlight);

    const say = (): void => {
      banner.textContent =
        `proc123 — click the ${labels[step] ?? '?'} on any one product ` +
        `(${String(step + 1)} of ${String(labels.length)}). Press Esc to cancel.`;
    };
    say();

    /** Index path from <html>, counting element children only. */
    const pathOf = (element: Element): number[] => {
      const path: number[] = [];
      let node: Element | null = element;
      while (node !== null && node.parentElement !== null) {
        const parent: Element = node.parentElement;
        path.unshift(Array.prototype.indexOf.call(parent.children, node));
        node = parent;
      }
      return path;
    };

    const isOurs = (element: Element | null): boolean =>
      element !== null && element.closest('[data-proc123-ui]') !== null;

    const onMove = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target === null || isOurs(target)) {
        highlight.style.display = 'none';
        return;
      }
      const box = target.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = `${String(box.left)}px`;
      highlight.style.top = `${String(box.top)}px`;
      highlight.style.width = `${String(box.width)}px`;
      highlight.style.height = `${String(box.height)}px`;
    };

    const finish = (cancelled: boolean): void => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      banner.remove();
      highlight.remove();
      resolve({ paths, cancelled });
    };

    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target === null || isOurs(target)) return;

      // The page's own handlers must not fire: on a product card, the first
      // click would navigate away and the teaching session would end there.
      event.preventDefault();
      event.stopPropagation();

      paths.push(pathOf(target));
      step += 1;
      if (step >= labels.length) finish(false);
      else say();
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(true);
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
}
