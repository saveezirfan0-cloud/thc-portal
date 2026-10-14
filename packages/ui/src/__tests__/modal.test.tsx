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

  it('counts a radio group with a checked radio as one stop, so Tab from it wraps', () => {
    function RadioHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            Rate
          </button>
          <Modal open={open} title="Rating" onClose={() => setOpen(false)}>
            <textarea id="note" />
            <input type="radio" name="stars" value="1" id="r1" />
            <input type="radio" name="stars" value="2" id="r2" defaultChecked />
            <input type="radio" name="stars" value="3" id="r3" />
          </Modal>
        </>
      );
    }
    mount(<RadioHarness />);
    openFromButton();
    const close = $('button[aria-label="Close"]');
    const checked = $('#r2');

    // The checked radio is the dialog's last tab stop, though #r3 comes after it.
    checked.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    close.focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(checked);
  });

  it('keeps every radio of a group with none checked', () => {
    function RadioHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            Rate
          </button>
          <Modal open={open} title="Rating" onClose={() => setOpen(false)}>
            <input type="radio" name="stars" value="1" id="r1" />
            <input type="radio" name="stars" value="2" id="r2" />
          </Modal>
        </>
      );
    }
    mount(<RadioHarness />);
    openFromButton();
    $('#r2').focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($('button[aria-label="Close"]'));
  });
});

describe('Modal with a filled-in form (release audit E-M4, m2)', () => {
  function FormHarness({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
    const [open, setOpen] = useState(true);
    const [text, setText] = useState('');
    return open ? (
      <Modal
        open
        title="Edit"
        dirty={text !== ''}
        onSubmit={onSubmit}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        footer={
          <button type="submit" id="save" disabled={text === ''}>
            Save
          </button>
        }
      >
        <input id="name" value={text} onChange={(event) => setText(event.target.value)} />
      </Modal>
    ) : null;
  }

  const type = (value: string) => {
    const input = $<HTMLInputElement>('#name');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const button = (text: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;

  it('closes at once while nothing has changed', () => {
    const onClose = vi.fn();
    mount(<FormHarness onClose={onClose} onSubmit={() => {}} />);
    act(() => $('.modal-back').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks "Discard your changes?" on Escape, the backdrop and the ×, and keeps the form', () => {
    const onClose = vi.fn();
    mount(<FormHarness onClose={onClose} onSubmit={() => {}} />);
    type('Leonardo');

    $('#name').focus();
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect($('[role="alertdialog"]').textContent).toContain('Discard your changes?');
    // A second Escape is "keep editing".
    key('Escape');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    act(() => $('.modal-back').click());
    expect(document.activeElement).toBe(button('Keep editing'));
    act(() => button('Keep editing').click());
    expect($<HTMLInputElement>('#name').value).toBe('Leonardo');

    act(() => $('button[aria-label="Close"]').click());
    act(() => button('Discard').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a real form: Enter submits through the enabled submit button', () => {
    const onSubmit = vi.fn();
    mount(<FormHarness onClose={() => {}} onSubmit={onSubmit} />);
    const form = $<HTMLFormElement>('form.modal-form');
    expect(form.noValidate).toBe(true);
    type('Leonardo');
    act(() => form.requestSubmit($('#save')));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
