import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@thc/notifications';
import { ReminderEmailsScreen } from '../ReminderEmailsScreen';
import { LOGO_DATA_URL, SAMPLE_NAME, reminderPreviews } from '../previews';
import {
  REMINDER_EMAILS,
  countsFor,
  parseOnboardingEmailReport,
  sentTodayTotal,
  stageTotals,
} from '../reminders';

/**
 * ADR-0187 · /onboarding/reminders: each reminder rendered from the register
 * as it is sent, the numbers beside it, read defensively.
 */

const LINKS = {
  appLink: 'https://staff.thehospitalitycompany.co.uk/onboarding',
  activationLink: 'https://staff.thehospitalitycompany.co.uk/activate/sample-link',
  installLink: 'https://staff.thehospitalitycompany.co.uk/install',
};

const REPORT = parseOnboardingEmailReport({
  today: '2026-10-22',
  stalledAfter: 3,
  switches: { OC1: true, OC2: true, OC3: true, OC4: false },
  stages: {
    interview: { waiting: 350, remindedToday: 198, stalled: 120, lastFailed: 2 },
    activation: { waiting: 15, remindedToday: 6, stalled: 4, lastFailed: 0 },
    app: { waiting: 38, remindedToday: 20, stalled: 9, lastFailed: 1, withPush: 6 },
  },
  steps: [
    { step: 'your home address', n: 12 },
    { step: 'the Health & Safety quiz', n: 7 },
  ],
  besidePush: { sentToday: 6, sentTotal: 40, failedTotal: 0 },
  emails: [
    {
      id: 'OC1:first',
      sentToday: 150,
      sentTotal: 900,
      failedTotal: 3,
      queued: 2,
      people: 400,
      lastSentAt: '2026-10-22T09:08:00Z',
      nextAt: '2026-10-22T10:00:00Z',
    },
    {
      id: 'OC4:second',
      sentToday: 5,
      sentTotal: 30,
      failedTotal: 1,
      queued: 0,
      people: 20,
      lastSentAt: null,
      nextAt: null,
    },
  ],
});

describe('the reminders listed', () => {
  it('are the fifteen onboarding_email_report() counts, in its order', () => {
    const sql = readFileSync(
      new URL(
        '../../../../../../supabase/migrations/20261023130000_onboarding_email_report.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const ids = [
      ...sql.slice(sql.indexOf('ids(id, n) as')).matchAll(/\('(OC\d:[a-z_]+)', \d+\)/g),
    ].map((m) => m[1]);
    expect(REMINDER_EMAILS.map((e) => e.id)).toEqual(ids);
    expect(ids).toHaveLength(15);
  });

  it('name a variant the register has, on the channel the register gives it', () => {
    for (const e of REMINDER_EMAILS) {
      expect(Object.keys(TEMPLATES[e.template].variants ?? {}), e.id).toContain(e.variant);
      expect(TEMPLATES[e.template].channel, e.id).toBe(e.channel);
    }
  });
});

describe('reminderPreviews', () => {
  const previews = reminderPreviews(LINKS);
  const byId = new Map(previews.map((p) => [p.id, p]));

  it('renders every reminder, by id, with nothing left unfilled', () => {
    expect(previews.map((p) => p.id)).toEqual(REMINDER_EMAILS.map((e) => e.id));
    for (const p of previews) {
      expect(p.text, p.id).not.toMatch(/\{\w+\}/);
      expect(p.subject, p.id).not.toMatch(/\{\w+\}/);
    }
  });

  it('draws an email as HTML with the logo inlined, and a push as its words only', () => {
    for (const e of REMINDER_EMAILS) {
      const p = byId.get(e.id)!;
      if (e.channel === 'email') {
        expect(p.html, e.id).toMatch(/^<!DOCTYPE html>/);
        expect(p.html, e.id).not.toContain('cid:');
        expect(p.text, e.id).toContain(`Hi ${SAMPLE_NAME},`);
      } else {
        expect(p.html, e.id).toBeNull();
        expect(p.text, e.id).toMatch(/(Next up|Still to do): your two references/);
      }
    }
    expect(byId.get('OC1:first')!.html).toContain(LOGO_DATA_URL.slice(0, 40));
  });

  it('is the register, not a copy: OC4 carries the steps to do, OC2 the sample link', () => {
    const oc4 = byId.get('OC4:first')!;
    expect(oc4.subject).toBe('Pick up where you left off with your onboarding');
    expect(oc4.text).toContain("Here's what to do:");
    expect(oc4.text).toContain('2. Give two referees who are not relatives');
    expect(oc4.text).toContain(LINKS.appLink);
    expect(byId.get('OC2:first')!.text).toContain(LINKS.activationLink);
  });
});

describe('parseOnboardingEmailReport', () => {
  it('reads a missing or malformed answer as zero, never a crash', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}, { emails: 'no', stages: [], steps: {} }]) {
      const r = parseOnboardingEmailReport(raw);
      expect(r.stalledAfter).toBe(3);
      expect(r.emails).toEqual({});
      expect(r.steps).toEqual([]);
      expect(stageTotals(r)).toEqual({
        waiting: 0,
        remindedToday: 0,
        stalled: 0,
        lastFailed: 0,
        withPush: 0,
      });
      expect(r.switches).toEqual({ OC1: true, OC2: true, OC3: true, OC4: true });
    }
  });

  it('reads the counts, and zero for a reminder the report has no row for', () => {
    expect(countsFor(REPORT, 'OC1:first').sentTotal).toBe(900);
    expect(countsFor(REPORT, 'OC2:repeat')).toMatchObject({
      sentToday: 0,
      sentTotal: 0,
      nextAt: null,
    });
    expect(countsFor(null, 'OC1:first').sentTotal).toBe(0);
    expect(sentTodayTotal(REPORT)).toBe(155);
    expect(stageTotals(REPORT)).toMatchObject({
      waiting: 403,
      remindedToday: 224,
      stalled: 133,
      lastFailed: 3,
    });
  });
});

describe('ReminderEmailsScreen', () => {
  const previews = reminderPreviews(LINKS);
  const html = renderToStaticMarkup(
    <ReminderEmailsScreen report={REPORT} previews={previews} problem={null} />,
  );

  it('shows the tiles, the stages and the steps they are stuck at', () => {
    expect(html).toContain('Being reminded now');
    expect(html).toContain('Stalled');
    expect(html).toContain('Waiting on their video interview');
    expect(html).toContain('Accepted, account not set up');
    expect(html).toContain('6 with notifications on · 32 without');
    expect(html).toContain('your home address');
    expect(html).toContain('/onboarding?attention=stalled');
  });

  it('lists every reminder under its group, with its subject and a View', () => {
    for (const e of REMINDER_EMAILS) expect(html).toContain(`View the reminder: ${e.name}`);
    expect(html).toContain('Pick up where you left off with your onboarding');
    expect(html).toContain('In the app, a step to do');
  });

  it('says which are switched off, and how many app emails went beside a push', () => {
    expect(html).toContain('Off');
    expect(html).toContain('40 went to a candidate who also gets');
  });

  it('shows the reminders without numbers, and why, when the report could not be read', () => {
    const bare = renderToStaticMarkup(
      <ReminderEmailsScreen
        report={null}
        previews={previews}
        problem="The reminder numbers could not be read: boom"
      />,
    );
    expect(bare).toContain('The reminder numbers could not be read: boom');
    expect(bare).toContain('View the reminder: Interview reminder · first');
    expect(bare).not.toContain('Being reminded now');
  });
});
