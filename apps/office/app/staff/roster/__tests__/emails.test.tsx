import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@thc/notifications';
import { EmailsPanel } from '../EmailsPanel';
import { LOGO_DATA_URL, SAMPLE_NAME, emailPreviews } from '../email-previews';
import {
  STAFF_EMAILS,
  countsFor,
  failureReason,
  parseEmailRecords,
  parseStaffEmailReport,
} from '../emails';

/**
 * ADR-0141 · /staff/roster "Emails staff receive": each email rendered from
 * the register as it is sent, the numbers beside it, read defensively.
 */

const APPLY = 'https://staff.thehospitalitycompany.co.uk/apply';
const NO_MORE_SHIFTS = 'we will be unable to offer you any more shifts going forwards';

describe('the emails listed', () => {
  it('are the five staff_email_report() counts, in its order', () => {
    expect(STAFF_EMAILS.map((e) => e.id)).toEqual([
      'IR1',
      'OC1:existing_first',
      'OC1:existing_second',
      'OC1:existing_repeat',
      'OC1:existing_notice',
    ]);
  });

  it('name a variant the register has, for every one', () => {
    for (const e of STAFF_EMAILS) {
      expect(Object.keys(TEMPLATES[e.template].variants ?? {}), e.id).toContain(e.variant);
    }
  });
});

describe('emailPreviews', () => {
  const previews = emailPreviews(APPLY);
  const byId = new Map(previews.map((p) => [p.id, p]));

  it('renders every email, by name, with nothing left unfilled', () => {
    expect(previews.map((p) => p.id)).toEqual(STAFF_EMAILS.map((e) => e.id));
    for (const p of previews) {
      expect(p.text, p.id).toContain(`Hi ${SAMPLE_NAME},`);
      expect(p.text, p.id).not.toMatch(/\{\w+\}/);
      expect(p.subject, p.id).not.toMatch(/\{\w+\}/);
      expect(p.html, p.id).toMatch(/^<!DOCTYPE html>/);
    }
  });

  it('is the register, not a copy: the subject and words the drain sends', () => {
    expect(byId.get('OC1:existing_notice')!.subject).toBe(
      'Important: complete your Willo interview to keep getting shifts',
    );
    expect(byId.get('IR1')!.subject).toBe(
      `${SAMPLE_NAME}, reminder: please complete your registration on the new THC Staff App`,
    );
    for (const p of previews) expect(p.text, p.id).toContain(NO_MORE_SHIFTS);
  });

  it("carries IR1's Register button to the apply page", () => {
    expect(byId.get('IR1')!.html).toContain(`href="${APPLY}"`);
    expect(byId.get('IR1')!.text).toContain(`Register now: ${APPLY}`);
  });

  it('shows the logo a mail app would attach, in a browser', () => {
    const oc1 = byId.get('OC1:existing_first')!.html;
    expect(oc1).not.toContain('cid:');
    expect(oc1).toContain(`src="${LOGO_DATA_URL}"`);
    expect(LOGO_DATA_URL).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  });
});

describe('parseStaffEmailReport', () => {
  it('reads the RPC, and reads nothing as zero', () => {
    const r = parseStaffEmailReport({
      today: '2026-10-15',
      interviewWaiting: 41,
      switches: { IR1: true, OC1: false },
      emails: [
        {
          id: 'IR1',
          sentToday: 3,
          sentTotal: 900,
          failedTotal: 2,
          queued: 1,
          people: 400,
          lastSentAt: '2026-10-15T09:08:00Z',
          nextAt: null,
        },
        { id: 'OC1:existing_notice', queued: 40, nextAt: '2026-10-15T09:00:00Z' },
        { sentTotal: 5 },
      ],
    });
    expect(r.interviewWaiting).toBe(41);
    expect(r.switches).toEqual({ IR1: true, OC1: false });
    expect(countsFor(r, 'IR1').sentTotal).toBe(900);
    expect(countsFor(r, 'OC1:existing_notice')).toMatchObject({ sentTotal: 0, queued: 40 });
    expect(countsFor(r, 'OC1:existing_repeat').sentTotal).toBe(0);
    expect(Object.keys(r.emails)).toEqual(['IR1', 'OC1:existing_notice']);
    expect(parseStaffEmailReport(null)).toMatchObject({ interviewWaiting: 0, emails: {} });
    expect(countsFor(null, 'IR1').sentToday).toBe(0);
  });
});

describe('EmailsPanel', () => {
  const previews = emailPreviews(APPLY);

  it('lists each email with its subject, numbers and a View', () => {
    const report = parseStaffEmailReport({
      interviewWaiting: 41,
      switches: { IR1: true, OC1: true },
      emails: [
        { id: 'IR1', sentToday: 312, sentTotal: 2741, people: 905, failedTotal: 7, queued: 0 },
      ],
    });
    const html = renderToStaticMarkup(
      <EmailsPanel report={report} previews={previews} problem={null} />,
    );
    for (const e of STAFF_EMAILS) expect(html).toContain(`<b>${e.name}</b>`);
    expect(html).toContain('Important: complete your Willo interview to keep getting shifts');
    expect(html).toContain('>2,741<');
    expect(html).toContain('>41<');
    expect(html).toContain('aria-label="View the email: One-off interview notice"');
    // The dialog is shut until View.
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('>Off<');
  });

  it('says when an email is switched off, and shows no numbers it could not read', () => {
    const off = parseStaffEmailReport({ switches: { IR1: false, OC1: true }, emails: [] });
    expect(
      renderToStaticMarkup(<EmailsPanel report={off} previews={previews} problem={null} />),
    ).toContain('>Off<');
    const html = renderToStaticMarkup(
      <EmailsPanel
        report={null}
        previews={previews}
        problem="The email numbers could not be read"
      />,
    );
    expect(html).toContain('The email numbers could not be read');
    expect(html).toContain('<td class="num">—</td>');
  });
});

describe('the records behind each count (ADR-0144)', () => {
  it('makes each count above zero a button that opens its records', () => {
    const report = parseStaffEmailReport({
      switches: { IR1: true, OC1: true },
      emails: [
        { id: 'OC1:existing_repeat', sentTotal: 59, people: 55, failedTotal: 49, queued: 0 },
      ],
    });
    const html = renderToStaticMarkup(
      <EmailsPanel
        report={report}
        previews={emailPreviews('https://x.example/apply')}
        problem={null}
      />,
    );
    expect(html).toContain(
      'aria-label="Not delivered: 49. Show who, for Interview reminder · every day after"',
    );
    expect(html).toContain(
      'aria-label="People: 55. Show who, for Interview reminder · every day after"',
    );
    // Nothing to show behind a zero.
    expect(html).not.toContain('Waiting: 0.');
  });

  it('reads a page of records, and nothing as empty', () => {
    const page = parseEmailRecords({
      total: 49,
      offset: 0,
      rows: [
        {
          email: 'a@x.co',
          staffId: 's1',
          name: 'Amara K',
          at: '2026-10-14T15:08:00Z',
          times: 1,
          error: 'Resend answered 422: invalid address',
        },
        { name: 'no address' },
      ],
    });
    expect(page.total).toBe(49);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ email: 'a@x.co', staffId: 's1', times: 1 });
    expect(parseEmailRecords(null)).toEqual({ total: 0, offset: 0, rows: [] });
  });

  it('puts the commonest failures in plain words, and keeps any other as it came', () => {
    expect(failureReason('Resend answered 422: invalid address')).toBe(
      'The email address is not valid',
    );
    expect(
      failureReason('not sent: the daily reminder was switched off on /staff/roster'),
    ).toContain('switched off');
    expect(failureReason('Something new')).toBe('Something new');
    expect(failureReason(null)).toBe('No reason recorded');
  });
});
