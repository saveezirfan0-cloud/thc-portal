'use client';

import { createContext, useContext, useEffect, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Alert, Panel } from '@thc/ui';
import type { ActionResult } from './types';

/**
 * The furniture every /settings block is built from: the panel with its
 * one-line statement of the rule, the Save that moves into the page's save
 * bar while the block has unsaved edits, the pending state and the one line
 * of feedback. In their own module so a block in its own file
 * (`BufferSuggestionBlock`) imports them without importing the screen.
 */

export const SaveSlot = createContext<{
  slot: HTMLElement | null;
  mark: (id: string, title: string, dirty: boolean) => void;
} | null>(null);

/**
 * Where a block's Save button is drawn: in the block while it is clean, in
 * the page's save bar while it has unsaved edits. The button is the same
 * element either way — only its place on the screen changes.
 */
export function SaveAction({
  id,
  title,
  dirty,
  children,
}: {
  id: string;
  title: string;
  dirty: boolean;
  children: ReactNode;
}) {
  const bar = useContext(SaveSlot);
  useMarkDirty(id, title, dirty);
  if (dirty && bar?.slot) return createPortal(children, bar.slot);
  return <>{children}</>;
}

/** Tells the screen a block has unsaved edits (the save bar's list and the guard). */
export function useMarkDirty(id: string, title: string, dirty: boolean) {
  const mark = useContext(SaveSlot)?.mark;
  useEffect(() => {
    mark?.(id, title, dirty);
    return () => mark?.(id, title, false);
  }, [mark, id, title, dirty]);
}

/** One block's save button, its pending state and its one line of feedback. */
export function useSave() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: () => Promise<ActionResult>, success = 'Saved.') => {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        setNote(success);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return { note, error, pending, run };
}

/**
 * `Panel` has a title and an actions slot but no sub-line, so the one-line
 * statement of WHICH section of the scope each block implements is rendered
 * as the first thing in the body. Every block here needs it: the values are
 * unrecognisable without the rule behind them.
 */
export function Block({
  title,
  sub,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  sub: ReactNode;
  actions?: ReactNode;
  /** `settings-wide`: across every column (the radii table). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Panel title={title} {...(actions ? { actions } : {})} {...(className ? { className } : {})}>
      <p className="sm muted">{sub}</p>
      {children}
    </Panel>
  );
}

/**
 * A block's one line of feedback. A refusal is brought into view (release
 * audit m1): the Save that failed may have been pressed in the save bar at
 * the bottom of the screen, far from the block — so the page scrolls to
 * the first field marked invalid in the block, or to this line, and puts
 * the keyboard there.
 */
export function Feedback({ note, error }: { note: string | null; error: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    const line = ref.current;
    const field = line
      ?.closest('.panel, .radius-row')
      ?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target = field ?? line;
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }, [error]);
  if (!error && !note) return null;
  return (
    <div ref={ref} tabIndex={-1} className="settings-feedback">
      {error ? <Alert tone="coral">{error}</Alert> : <Alert tone="green">{note}</Alert>}
    </div>
  );
}
