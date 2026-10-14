'use client';

import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ToastTone } from './Modal';

/**
 * Short confirmations that come and go (release audit L10, m3): "Venue
 * saved", "Marked as read", "Saved" beside an autosaving field, and the
 * Undo of a one-click remove. `toast()` can be called from anywhere on the
 * client; one `<Toaster />` in the app shell draws them, bottom-right
 * (above the tab bar on a phone), newest last, each gone after a few
 * seconds or on its ×.
 *
 * A toast never carries the only copy of an error: a refusal still shows
 * next to what was refused. It is a receipt.
 */
export interface ToastOptions {
  tone?: ToastTone;
  /** One action, e.g. Undo. Pressing it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen; 5 s, or 8 s with an action. */
  duration?: number;
}

interface Item extends ToastOptions {
  id: number;
  message: ReactNode;
}

let items: readonly Item[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number): void {
  const before = items.length;
  items = items.filter((item) => item.id !== id);
  if (items.length !== before) emit();
}

/** Shows a toast; returns its id (for `dismissToast`). */
export function toast(message: ReactNode, options: ToastOptions = {}): number {
  const id = nextId++;
  // At most three at once: the oldest goes first.
  items = [...items, { id, message, ...options }].slice(-3);
  emit();
  if (typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(id), options.duration ?? (options.action ? 8000 : 5000));
  }
  return id;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => items;
const none: readonly Item[] = [];

export function Toaster() {
  const shown = useSyncExternalStore(subscribe, snapshot, () => none);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {shown.map((item) => (
        <div key={item.id} className={item.tone ? `toast ${item.tone}` : 'toast'}>
          <span className="toast-text">{item.message}</span>
          {item.action ? (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                dismissToast(item.id);
                item.action?.onClick();
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="btn sm ghost icon"
            aria-label="Dismiss"
            onClick={() => dismissToast(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
