// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Withdraw approval" on a verified completion letter (ADR-0183), and the
 * safety extras ADR-0183 adds to ADR-0178's "Edit holiday periods" — which
 * the Withdraw dialog opens when the term letter needs correcting first.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const ok = () => Promise.resolve({ ok: true as const, message: 'Done.' });
vi.mock('../letterActions', () => ({ withdrawCompletionApproval: vi.fn(ok) }));
vi.mock('../actions', () => ({ setTermLetterPeriods: vi.fn(ok) }));

const letterActions = await import('../letterActions');
const actions = await import('../actions');
const { VerifiedLetterActions, canWithdrawLetter, correctTermDatesFirst, currentTermLetterOf } =
  await import('../VerifiedLetterActions');
const { EditTermPeriods } = await import('../../_components/TermPeriods');

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

function tick(text: string): HTMLInputElement {
  const label = [...dialog().querySelectorAll('label')].find((l) => l.textContent?.includes(text));
  if (!label) throw new Error(`no tick ${text}`);
  return label.querySelector('input[type="checkbox"]')!;
}

describe('which letter offers Withdraw approval', () => {
  it('a verified completion letter only; the current term letter is the latest verified one', () => {
    expect(currentTermLetterOf([OLD_TERM, TERM, COMPLETION])?.id).toBe('t2');
    expect(canWithdrawLetter(COMPLETION)).toBe(true);
    expect(canWithdrawLetter({ ...COMPLETION, review_status: 'pending' })).toBe(false);
    expect(canWithdrawLetter(TERM)).toBe(false);
  });

  it('nothing for a login that may not write', () => {
    render(
      <VerifiedLetterActions
        doc={COMPLETION}
        currentTermLetter={TERM}
        canWithdraw={false}
        name="Prabin T."
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('Withdraw approval', () => {
  it('needs a reason, says what it does, and sends it', async () => {
    render(
      <VerifiedLetterActions
        doc={COMPLETION}
        currentTermLetter={TERM}
        canWithdraw
        name="Prabin T."
      />,
    );
    await click(button('Withdraw approval'));
    const text = dialog().textContent ?? '';
    expect(text).toContain('the letter gave 15.08.2026');
    expect(text).toContain('Their right-to-work date does not change.');
    expect(text).toContain('The worker is not sent a rejection');
    const withdraw = button('Withdraw approval', dialog());
    expect(withdraw.disabled).toBe(true);
    type(field('Reason'), 'Course resumes 18/01/2027 — not completed');
    await click(withdraw);
    expect(letterActions.withdrawCompletionApproval).toHaveBeenCalledExactlyOnceWith(
      'c1',
      'Course resumes 18/01/2027 — not completed',
    );
  });

  it('says to correct the term dates first when withdrawing would put them on term time today, and opens Edit holiday periods', async () => {
    // 21/10/2026 is in no holiday on a letter with no dates.
    expect(correctTermDatesFirst(TERM, '2026-10-21')).toBe(true);
    const holiday = { ...TERM, term_dates: ['[2026-08-16,2027-01-18)'] };
    expect(correctTermDatesFirst(holiday, '2026-10-21')).toBe(false);
    expect(correctTermDatesFirst(holiday, '2027-01-18')).toBe(true);
    expect(correctTermDatesFirst(null, '2026-10-21')).toBe(false);

    render(
      <VerifiedLetterActions
        doc={COMPLETION}
        currentTermLetter={TERM}
        canWithdraw
        name="Prabin T."
      />,
    );
    await click(button('Withdraw approval'));
    expect(dialog().textContent).toContain(
      'correct the term dates first, so the worker is only told once about their new limit',
    );
    await click(button('Correct term dates first', dialog()));
    // ADR-0178's dialog, for the term letter.
    expect(dialog().textContent).toContain('Holiday periods — Prabin T.');
    await click(button('+ Add period', dialog()));
    type(field('Holiday 1 from') as HTMLInputElement, '16/08/2026');
    type(field('Holiday 1 to') as HTMLInputElement, '17/01/2027');
    expect(dialog().textContent).toContain('Letter expires 17.01.2027 (last date on the letter)');
    expect(dialog().textContent).toContain(
      'The worker will need to upload their next letter by then.',
    );
    await click(button('Save periods', dialog()));
    expect(actions.setTermLetterPeriods).toHaveBeenCalledExactlyOnceWith(
      't2',
      [{ from: '2026-08-16', to: '2027-01-17' }],
      false,
    );
  });

  it('no hint with the holiday already on file; a note when there is no term letter at all', async () => {
    render(
      <VerifiedLetterActions
        doc={COMPLETION}
        currentTermLetter={{ ...TERM, term_dates: ['[2026-08-16,2027-01-18)'] }}
        canWithdraw
        name="Prabin T."
      />,
    );
    await click(button('Withdraw approval'));
    expect(dialog().textContent).not.toContain('Correct term dates first');
    act(() => root.unmount());
    root = createRoot(container);
    render(
      <VerifiedLetterActions
        doc={COMPLETION}
        currentTermLetter={null}
        canWithdraw
        name="Prabin T."
      />,
    );
    await click(button('Withdraw approval'));
    expect(dialog().textContent).toContain('There is no verified term letter on file.');
  });
});

describe('Edit holiday periods, with the ADR-0183 extras', () => {
  it('a letter left with no periods needs the tick before Save', async () => {
    render(
      <EditTermPeriods
        docId="t2"
        ranges={['[2026-12-19,2027-01-11)']}
        allowed
        name="Prabin T."
        uploadedAt="2026-09-20T10:00:00Z"
      />,
    );
    await click(button('Edit holiday periods'));
    expect(dialog().textContent).toContain('Letter expires 10.01.2027 (last date on the letter)');
    await click(button('remove', dialog()));
    expect(dialog().textContent).toContain(
      'Letter expires 31.12.2026 (no dates on the letter — calendar-year fallback)',
    );
    const save = button('Save periods', dialog());
    expect(save.disabled).toBe(true);
    await click(tick('This letter shows no holidays.'));
    expect(save.disabled).toBe(false);
    await click(save);
    expect(actions.setTermLetterPeriods).toHaveBeenCalledExactlyOnceWith('t2', [], true);
  });

  it('a period longer than a year is said in words and blocks Save', async () => {
    render(
      <EditTermPeriods
        docId="t2"
        ranges={['[2026-12-19,2027-01-11)']}
        allowed
        name="Prabin T."
        uploadedAt="2026-09-20T10:00:00Z"
      />,
    );
    await click(button('Edit holiday periods'));
    type(field('Holiday 1 to') as HTMLInputElement, '10/01/2072');
    expect(dialog().textContent).toContain(
      'Period 1 runs for more than a year — check the year of each date.',
    );
    expect(button('Save periods', dialog()).disabled).toBe(true);
  });
});
