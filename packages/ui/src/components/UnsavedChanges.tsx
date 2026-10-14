'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface UnsavedChangesOptions {
  /** The dialog's title. */
  title?: string;
  /** What is lost, in a sentence: "The event you are building has not been saved." */
  message?: ReactNode;
}

export interface UnsavedChanges {
  /** Render once, anywhere in the form's screen. */
  dialog: ReactNode;
  /**
   * For the form's own way out (Cancel, Back): runs `proceed` at once when
   * nothing has changed, and after "Discard changes" when something has.
   */
  confirm: (proceed: () => void) => void;
}

/**
 * The unsaved-changes guard of a long form (release audit E-M4, m1): the
 * Shift Builder and /settings.
 *
 * While `dirty`:
 *   - closing the tab, reloading or typing another address asks the
 *     browser's own "Leave site?" (`beforeunload` — its wording is the
 *     browser's and cannot be changed);
 *   - a click on a link inside the app (the sidebar, a breadcrumb, a row)
 *     is held, and a dialog asks "Leave without saving?" — Keep editing,
 *     or Discard changes, which follows the link as if it had not been
 *     stopped (a client-side navigation stays one);
 *   - `confirm(proceed)` puts the same question in front of the form's own
 *     Cancel.
 *
 * A link with `target`, `download` or a modifier key (a new tab) is not a
 * way out of the form and is left alone, as is an in-page `#anchor`. A
 * region marked `data-unsaved-ok` opts its links out.
 *
 * Not covered: the browser's Back button inside the app, which the App
 * Router answers from its own history without a cancellable event.
 */
export function useUnsavedChanges(
  dirty: boolean,
  {
    title = 'Leave without saving?',
    message = 'Your changes have not been saved and will be lost.',
  }: UnsavedChangesOptions = {},
): UnsavedChanges {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Set while the held link is clicked again on "Discard changes".
  const passing = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome before 119 and Safari still read this.
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (passing.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.closest('[data-unsaved-ok], [role="dialog"]')) return;
      if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return; // beforeunload asks
      const here = window.location;
      if (to.pathname === here.pathname && to.search === here.search && to.hash) return;
      // Captured on the document, so neither the browser nor the router
      // (Next's <Link> listens at React's root, below the document) sees it.
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => {
        passing.current = true;
        try {
          link.click();
        } finally {
          passing.current = false;
        }
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const confirm = useCallback((proceed: () => void) => {
    if (dirtyRef.current) setPending(() => proceed);
    else proceed();
  }, []);

  const stay = () => setPending(null);
  const leave = () => {
    const go = pending;
    setPending(null);
    go?.();
  };

  const dialog = (
    <Modal
      open={pending !== null}
      title={title}
      onClose={stay}
      footer={
        <>
          <Button onClick={stay} autoFocus>
            Keep editing
          </Button>
          <Button tone="danger" onClick={leave}>
            Discard changes
          </Button>
        </>
      }
    >
      <p className="sm">{message}</p>
    </Modal>
  );

  return { dialog, confirm };
}
