// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { useUnsavedChanges } from '../components/UnsavedChanges';
import { Toaster, toast } from '../components/Toaster';

/**
 * The Shift Builder and /settings lost a filled-in form to a sidebar link
 * or Cancel without a word (release audit E-M4, m1).
 */
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;

function Form({ onLink, onCancel }: { onLink: () => void; onCancel: () => void }) {
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedChanges(dirty);
  return (
    <>
      <a
        href="/dashboard"
        id="nav"
        onClick={(event) => {
          event.preventDefault();
          onLink();
        }}
      >
        Dashboard
      </a>
      <button type="button" id="edit" onClick={() => setDirty(true)}>
        edit
      </button>
      <button type="button" id="cancel" onClick={() => guard.confirm(onCancel)}>
        Cancel
      </button>
      {guard.dialog}
    </>
  );
}

describe('useUnsavedChanges', () => {
  it('lets everything through while the form is clean', () => {
    const onLink = vi.fn();
    const onCancel = vi.fn();
    mount(<Form onLink={onLink} onCancel={onCancel} />);
    act(() => $('#nav').click());
    act(() => $('#cancel').click());
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('holds a link and Cancel while dirty, and follows them on "Discard changes"', () => {
    const onLink = vi.fn();
    const onCancel = vi.fn();
    mount(<Form onLink={onLink} onCancel={onCancel} />);
    act(() => $('#edit').click());

    act(() => $('#nav').click());
    expect(onLink).not.toHaveBeenCalled();
    expect($('[role="dialog"]').textContent).toContain('Leave without saving?');
    act(() => button('Keep editing').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onLink).not.toHaveBeenCalled();

    act(() => $('#nav').click());
    act(() => button('Discard changes').click());
    expect(onLink).toHaveBeenCalledTimes(1);

    act(() => $('#cancel').click());
    expect(onCancel).not.toHaveBeenCalled();
    act(() => button('Discard changes').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves a new-tab click alone', () => {
    const onLink = vi.fn();
    mount(<Form onLink={onLink} onCancel={() => {}} />);
    act(() => $('#edit').click());
    act(() => {
      $('#nav').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
      );
    });
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks the browser before the tab closes while dirty', () => {
    mount(<Form onLink={() => {}} onCancel={() => {}} />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    act(() => $('#edit').click());
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe('Toaster', () => {
  it('shows a receipt with its action, and the action dismisses it', () => {
    const undo = vi.fn();
    mount(<Toaster />);
    act(() => {
      toast('Role removed', { tone: 'green', action: { label: 'Undo', onClick: undo } });
    });
    expect($('.toaster').getAttribute('role')).toBe('status');
    expect($('.toaster .toast.green').textContent).toContain('Role removed');
    act(() => button('Undo').click());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toaster .toast')).toBeNull();
  });
});
