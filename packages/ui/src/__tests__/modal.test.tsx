// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Modal } from '../components/Modal';

/**
 * A modal is `aria-modal`: the page behind it is gone as far as assistive
 * technology is concerned. So focus has to stay inside it while it is open,
 * Escape has to leave it, and closing it has to put the keyboard back where
 * it was — or the next Tab starts again from the top of the page.
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

function Harness({
  onClose = () => {},
  dismissible,
}: {
  onClose?: () => void;
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Leave feedback
      </button>
      <Modal
        open={open}
        title="Feedback"
        dismissible={dismissible}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        footer={
          <button type="button" id="send">
            Send
          </button>
        }
      >
        <textarea id="note" />
      </Modal>
    </>
  );
}

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function openFromButton() {
  const opener = $('#opener');
  opener.focus();
  act(() => opener.click());
  return opener;
}

function key(name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

describe('Modal', () => {
  it('takes focus when it opens', () => {
    mount(<Harness />);
    openFromButton();
    expect(document.activeElement).toBe($('[role="dialog"]'));
  });

  it('keeps Tab inside: last wraps to first, Shift+Tab on first wraps to last', () => {
    mount(<Harness />);
    openFromButton();
    const close = $('button[aria-label="Close"]');
    const send = $('#send');

    send.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    close.focus();
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(send);

    // From the dialog box itself, Shift+Tab goes to the last control too.
    $('[role="dialog"]').focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(send);

    // In the middle, Tab is the browser's own: nothing is intercepted.
    $('#note').focus();
    expect(key('Tab').defaultPrevented).toBe(false);
  });

  it('pulls a stray focus back in', () => {
    mount(<Harness />);
    const opener = openFromButton();
    opener.focus(); // e.g. a click on the page behind the backdrop
    key('Tab');
    expect(document.activeElement).toBe($('button[aria-label="Close"]'));
  });

  it('closes on Escape and gives focus back to the opener', () => {
    const onClose = vi.fn();
    mount(<Harness onClose={onClose} />);
    const opener = openFromButton();
    $('#note').focus();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus after the × and after a backdrop click as well', () => {
    mount(<Harness />);
    const opener = openFromButton();
    act(() => $('button[aria-label="Close"]').click());
    expect(document.activeElement).toBe(opener);

    openFromButton();
    // A click inside the dialog is not a click on the backdrop.
    act(() => $('#note').click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => $('.modal-back').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('cannot be dismissed while dismissible={false}', () => {
    const onClose = vi.fn();
    mount(<Harness onClose={onClose} dismissible={false} />);
    openFromButton();

    key('Escape');
    act(() => $('.modal-back').click());
    const close = $<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close.disabled).toBe(true);
    act(() => close.click());

    expect(onClose).not.toHaveBeenCalled();
    expect($('[role="dialog"]').getAttribute('aria-busy')).toBe('true');
    // Still trapped: the disabled × drops out of the cycle.
    $('#send').focus();
    key('Tab');
    expect(document.activeElement).toBe($('#note'));
  });
});
