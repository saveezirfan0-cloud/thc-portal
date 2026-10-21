// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Correct term dates" and "Withdraw approval" on letters the office has
 * already decided (ADR-0178).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const ok = () => Promise.resolve({ ok: true as const, message: 'Done.' });
vi.mock('../letterActions', () => ({
  correctTermDates: vi.fn(ok),
  withdrawCompletionApproval: vi.fn(ok),
}));

const actions = await import('../letterActions');
const { VerifiedLetterActions, currentTermLetterId, letterCorrection } =
  await import('../VerifiedLetterActions');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TERM = {
  id: 't2',
  doc_type: 'university_term_dates_letter',
  review_status: 'verified',
  uploaded_at: '2026-09-20T10:00:00Z',
  term_dates: [] as string[],
};
const OLD_TERM = { ...TERM, id: 't1', uploaded_at: '2025-09-20T10:00:00Z' };
const COMPLETION = {
  id: 'c1',
  doc_type: 'university_completion_letter',
  review_status: 'verified',
  uploaded_at: '2026-09-25T10:00:00Z',
  completion_date: '2026-08-15',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T09:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
}

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function dialog(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('no dialog open');
  return el;
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const el = [...dialog().querySelectorAll('label')].find((l) => l.textContent?.startsWith(label));
  if (!el) throw new Error(`no field ${label}`);
  return document.getElementById(el.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

describe('which decided letter offers what', () => {
  it('the current verified term letter is the latest verified one; only it is corrected', () => {
    const current = currentTermLetterId([OLD_TERM, TERM, COMPLETION]);
    expect(current).toBe('t2');
    expect(letterCorrection(TERM, current)).toBe('term_dates');
    expect(letterCorrection(OLD_TERM, current)).toBeNull();
    expect(letterCorrection(COMPLETION, current)).toBe('withdraw');
    expect(letterCorrection({ ...COMPLETION, review_status: 'pending' }, current)).toBeNull();
    expect(letterCorrection({ ...TERM, doc_type: 'passport' }, current)).toBeNull();
  });

  it('nothing for a role that may not', () => {
    render(<VerifiedLetterActions doc={TERM} currentTermLetter="t2" canCorrect={false} />);
    expect(container.textContent).toBe('');
  });
});

describe('Correct term dates', () => {
  it('the office enters the holiday the AI missed, with a note', async () => {
    render(<VerifiedLetterActions doc={TERM} currentTermLetter="t2" canCorrect />);
    await click(button('Correct term dates'));
    const save = button('Save corrected dates', dialog());
    expect(save.disabled).toBe(true);
    await click(button('+ Add period', dialog()));
    type(field('Period 1 from') as HTMLInputElement, '16/08/2026');
    type(field('Period 1 to') as HTMLInputElement, '17/01/2027');
    expect(dialog().textContent).toContain('added by hand');
    expect(dialog().textContent).toContain('Letter expires 17.01.2027 (last date on the letter)');
    expect(save.disabled).toBe(true);
    type(field('Why are the dates being corrected?'), 'Course restarts 18/01/2027');
    expect(save.disabled).toBe(false);
    await click(save);
    expect(actions.correctTermDates).toHaveBeenCalledExactlyOnceWith(
      't2',
      [{ from: '2026-08-16', to: '2027-01-17' }],
      'Course restarts 18/01/2027',
      false,
    );
  });

  it('opens on the dates on file, marked as verified, and a change is edited by hand', async () => {
    render(
      <VerifiedLetterActions
        doc={{ ...TERM, term_dates: ['[2026-12-19,2027-01-11)'] }}
        currentTermLetter="t2"
        canCorrect
      />,
    );
    await click(button('Correct term dates'));
    expect(dialog().textContent).toContain('as verified');
    type(field('Period 1 to') as HTMLInputElement, '17/01/2027');
    expect(dialog().textContent).toContain('edited by hand');
  });
});

describe('Withdraw approval', () => {
  it('needs a reason, says what it does, and sends it', async () => {
    render(<VerifiedLetterActions doc={COMPLETION} currentTermLetter="t2" canCorrect />);
    await click(button('Withdraw approval'));
    const text = dialog().textContent ?? '';
    expect(text).toContain('the letter gave 15.08.2026');
    expect(text).toContain('Their right-to-work date does not change.');
    expect(text).toContain('The worker is not sent a rejection');
    const withdraw = button('Withdraw approval', dialog());
    expect(withdraw.disabled).toBe(true);
    type(field('Reason'), 'Course resumes 18/01/2027 — not completed');
    await click(withdraw);
    expect(actions.withdrawCompletionApproval).toHaveBeenCalledExactlyOnceWith(
      'c1',
      'Course resumes 18/01/2027 — not completed',
    );
  });
});
