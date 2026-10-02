import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InvoicingTimesheets } from '../_components/InvoicingTimesheets';
import { parseReportView, timesheetState, timesheetsToSend } from '../view-model';
import type { InvoicingTimesheet } from '../view-model';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * ADR-0081 (THC, 02.10.2026): the Completed Allocation Timesheet goes to the
 * client with the invoice, from Reports › Financial — not the morning after
 * the event, and not from the event page.
 */
const ROW: InvoicingTimesheet = {
  event_id: '11111111-1111-4111-8111-111111111111',
  event_title: 'Autumn Gala Dinner',
  event_date: '2026-09-19',
  client_name: 'The Dorchester',
  po_number: 'PO-4471',
  last_end: '2026-09-19T22:30:00Z',
  confirmed: 6,
  undetermined: 0,
  worked_min: 2520,
  contacts: 3,
  queued_at: null,
  sent_at: null,
  send_failed_at: null,
  automatic: false,
};

describe('where a Completed Timesheet stands (ADR-0081)', () => {
  it('not sent yet: ready to go with the invoice', () => {
    expect(timesheetState(ROW)).toEqual({
      tone: 'neutral',
      text: 'Not sent yet',
      canSend: true,
      sendLabel: 'Send to client',
      blocked: null,
    });
  });

  it('held while a No check-out would print blank Finish and Hours (RULE-02)', () => {
    const one = timesheetState({ ...ROW, undetermined: 1 });
    expect(one).toMatchObject({ tone: 'amber', text: '1 No check-out to resolve', canSend: false });
    expect(one.blocked).toBe(
      'Resolve the No check-out first: that row prints a blank Finish Time and Hours Worked.',
    );
    expect(timesheetState({ ...ROW, undetermined: 2 }).blocked).toBe(
      'Resolve the No check-outs first: those rows print a blank Finish Time and Hours Worked.',
    );
  });

  it('held while the client card has nobody to send to', () => {
    expect(timesheetState({ ...ROW, contacts: 0 })).toMatchObject({
      tone: 'amber',
      text: 'No contact email on the client card',
      canSend: false,
    });
  });

  it('reads the latest send: queued, sent, sent automatically, failed — UK stamps', () => {
    const queued = { ...ROW, queued_at: '2026-09-22T08:12:00Z' };
    expect(timesheetState(queued)).toMatchObject({
      tone: 'cyan',
      text: 'Queued Tue 22 Sep, 09:12 · waiting for the mail sender',
      sendLabel: 'Send again',
    });
    expect(timesheetState({ ...queued, sent_at: '2026-09-22T08:13:00Z' })).toMatchObject({
      tone: 'green',
      text: 'Sent Tue 22 Sep, 09:13',
    });
    expect(
      timesheetState({ ...queued, sent_at: '2026-09-20T09:00:04Z', automatic: true }).text,
    ).toBe('Sent automatically Sun 20 Sep, 10:00');
    expect(timesheetState({ ...queued, send_failed_at: '2026-09-22T08:14:00Z' })).toMatchObject({
      tone: 'coral',
      text: 'Send failed Tue 22 Sep, 09:14',
      canSend: true,
    });
  });

  it('counts what is still to send, a failed send included', () => {
    const queued = { ...ROW, queued_at: '2026-09-22T08:12:00Z' };
    expect(timesheetsToSend([ROW, queued, ROW])).toBe(2);
    expect(timesheetsToSend([{ ...queued, send_failed_at: '2026-09-22T08:14:00Z' }])).toBe(1);
    expect(timesheetsToSend([{ ...queued, sent_at: '2026-09-22T08:13:00Z' }])).toBe(0);
  });
});

describe('the Completed Timesheets panel on Reports › Financial', () => {
  const view = parseReportView({ from: '2026-09-14', to: '2026-09-20' }, '2026-09-22');

  it('lists the event with its PO number, Total Hours, Download and Send to client', () => {
    const markup = renderToStaticMarkup(
      <InvoicingTimesheets view={view} rows={[ROW]} problem={null} readOnly={false} />,
    );
    expect(markup).toContain('Completed Timesheets · for invoicing');
    expect(markup).toContain('1 to send');
    expect(markup).toContain('The Dorchester');
    expect(markup).toContain('PO-4471');
    expect(markup).toContain('42.00');
    expect(markup).toContain(`href="/api/documents/${ROW.event_id}?kind=signout">Download</a>`);
    expect(markup).toContain('>Send to client</button>');
  });

  it('a viewer sees the list and no Send (ADR-0060)', () => {
    const markup = renderToStaticMarkup(
      <InvoicingTimesheets view={view} rows={[ROW]} problem={null} readOnly />,
    );
    expect(markup).toContain('Download');
    expect(markup).not.toContain('Send to client');
  });

  it('a held row shows no Total Hours and a disabled Send', () => {
    const markup = renderToStaticMarkup(
      <InvoicingTimesheets
        view={view}
        rows={[{ ...ROW, undetermined: 1 }]}
        problem={null}
        readOnly={false}
      />,
    );
    expect(markup).not.toContain('42.00');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Send to client<\/button>/);
  });

  it('says so when nothing has finished yet', () => {
    const markup = renderToStaticMarkup(
      <InvoicingTimesheets view={view} rows={[]} problem={null} readOnly={false} />,
    );
    expect(markup).toContain('No event in this period has finished with staff on it yet.');
    expect(markup).not.toContain('to send');
  });
});
