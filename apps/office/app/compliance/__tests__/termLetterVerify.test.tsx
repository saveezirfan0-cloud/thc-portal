// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TermLetterVerifyModal } from '../TermLetterVerifyModal';
import type { QueueRow } from '../types';

/**
 * Verify on a University Term Dates Letter from Needs review and the
 * /staff/:id Documents tab (ADR-0178): the candidate screen's holiday-period
 * editor, pre-filled with what the AI read, and Verify sends exactly what is
 * on screen.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW = {
  kind: 'document',
  item_id: 'd1',
  staff_id: 's1',
  display_name: 'Prabin T.',
  employee_id: 912,
  status: 'compliant',
  is_candidate: false,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'international_student',
  photo_path: null,
  item_type: 'university_term_dates_letter',
  item_label: 'University Term Dates Letter',
  submitted_at: '2026-10-20T10:00:00Z',
  file_path: null,
  ai_confidence: 0.91,
  needs_manual_review: false,
  expiry_date: null,
  // The AI read the holiday as ending on 10/01/2027.
  term_dates: ['[2026-08-16,2027-01-11)'],
  below_degree_level: false,
} as unknown as QueueRow;

let container: HTMLDivElement;
let root: Root;
const onVerify = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T09:00:00Z'));
  onVerify.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(row: QueueRow = ROW) {
  act(() => {
    root.render(
      <TermLetterVerifyModal row={row} busy={false} onClose={onClose} onVerify={onVerify} />,
    );
  });
}

function dialog(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('no dialog open');
  return el;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function field(label: string): HTMLInputElement {
  const el = [...dialog().querySelectorAll('label')].find((l) => l.textContent === label);
  if (!el) throw new Error(`no field ${label}`);
  return document.getElementById(el.htmlFor) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('the term letter Verify dialog', () => {
  it('opens on the AI’s periods, with their source and the expiry they give', () => {
    render();
    const text = dialog().textContent ?? '';
    expect(text).toContain('Term dates read from the letter');
    expect(text).toContain('Holiday 1');
    expect(text).toContain('AI 91%');
    expect(field('Period 1 from').value).toBe('16/08/2026');
    expect(field('Period 1 to').value).toBe('10/01/2027');
    expect(text).toContain('Letter expires 10.01.2027 (last date on the letter)');
    expect(text).toContain('Course is below degree level');
    expect(button('Verify').disabled).toBe(false);
  });

  it('a corrected date is marked edited by hand, and moves the expiry live', async () => {
    render();
    type(field('Period 1 to'), '17/01/2027');
    const text = dialog().textContent ?? '';
    expect(text).toContain('edited by hand');
    expect(text).not.toContain('AI 91%');
    expect(text).toContain('Letter expires 17.01.2027 (last date on the letter)');
    await click(button('Verify'));
    expect(onVerify).toHaveBeenCalledExactlyOnceWith(
      { termDates: [{ from: '2026-08-16', to: '2027-01-17' }], noHolidays: false },
      { belowDegreeLevel: false },
    );
  });

  it('+ Add period: Verify waits until the new row is complete, and it is added by hand', async () => {
    render();
    await click(button('+ Add period'));
    expect(dialog().textContent).toContain('Period 2 needs both dates.');
    expect(dialog().textContent).toContain('added by hand');
    expect(button('Verify').disabled).toBe(true);
    type(field('Period 2 from'), '12/06/2027');
    expect(button('Verify').disabled).toBe(true);
    type(field('Period 2 to'), '26/09/2027');
    expect(button('Verify').disabled).toBe(false);
    expect(dialog().textContent).toContain('Letter expires 26.09.2027 (last date on the letter)');
    await click(button('Verify'));
    expect(onVerify).toHaveBeenCalledExactlyOnceWith(
      {
        termDates: [
          { from: '2026-08-16', to: '2027-01-10' },
          { from: '2027-06-12', to: '2027-09-26' },
        ],
        noHolidays: false,
      },
      { belowDegreeLevel: false },
    );
  });

  it('a period typed backwards is said in words and blocks Verify', () => {
    render();
    type(field('Period 1 from'), '18/01/2027');
    expect(dialog().textContent).toContain('Period 1 ends before it starts.');
    expect(button('Verify').disabled).toBe(true);
  });

  it('removing every period asks for the no-holidays tick before Verify', async () => {
    render({ ...ROW, staff_term_dates: ['[2026-08-16,2027-01-11)'] } as QueueRow);
    await click(button('remove'));
    const text = dialog().textContent ?? '';
    expect(text).toContain('No holiday periods — add any the letter shows.');
    expect(text).toContain(
      'This letter shows no holidays. The worker will be limited to 20 hours a week (10 below degree level) all year.',
    );
    expect(text).toContain(
      'Letter expires 31.12.2026 (no dates on the letter — calendar-year fallback)',
    );
    expect(text).toContain(
      'Verifying removes the holiday dates from their previous letter (16.08.2026–10.01.2027).',
    );
    expect(button('Verify').disabled).toBe(true);
    await click(tick('This letter shows no holidays.'));
    expect(button('Verify').disabled).toBe(false);
    await click(button('Verify'));
    expect(onVerify).toHaveBeenCalledExactlyOnceWith(
      { termDates: [], noHolidays: true },
      { belowDegreeLevel: false },
    );
  });

  it('says plainly when the new dates replace the previous letter’s', () => {
    render({ ...ROW, staff_term_dates: ['[2026-06-13,2026-09-22)'] } as QueueRow);
    expect(dialog().textContent).toContain(
      'Verifying replaces the holiday dates from their previous letter (13.06.2026–21.09.2026) with the ones above.',
    );
  });

  it('a letter whose dates have all run out cannot be verified as it stands', () => {
    render({ ...ROW, term_dates: ['[2026-06-13,2026-09-22)'] } as QueueRow);
    expect(dialog().textContent).toMatch(/The last date on this letter is 21\.09\.2026/);
    expect(button('Verify').disabled).toBe(true);
  });

  it('asks for the course level only on the student route', () => {
    render({ ...ROW, rtw_branch: 'work_visa' } as QueueRow);
    expect(dialog().textContent).not.toContain('Course is below degree level');
  });
});
