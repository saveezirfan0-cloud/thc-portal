import { describe, expect, it } from 'vitest';
import {
  barHeights,
  dayLabel,
  parseRosterReport,
  reminderSchedule,
  remindersSending,
  reminderSummary,
  share,
  statusLabel,
} from '../report';

/**
 * ADR-0123 · the /staff/roster report, as the screen reads it: the RPC's
 * jsonb is read defensively, and the words under the numbers.
 */
describe('parseRosterReport', () => {
  it('reads what invite_roster_report() returns', () => {
    const report = parseRosterReport({
      today: '2026-10-14',
      settings: { enabled: true, from: '10:00', until: '18:00' },
      kpis: {
        notAppliedThc: 896,
        sentToday: 890,
        failedTotal: 3,
        lastSentAt: '2026-10-14T09:38:00Z',
      },
      daily: [{ day: '2026-10-14', sent: 890, failed: 3 }],
      reminders: { 'a@b.co': { sent: 2, lastSentAt: '2026-10-14T09:10:00Z', lastError: null } },
      applied: ['row-1'],
      matches: [
        {
          entryId: 'row-2',
          staffId: 's-2',
          staffName: 'Chowdhury Moon',
          staffEmail: 'cm@b.co',
          status: 'documents',
          appliedAt: '2026-10-08T10:00:00Z',
        },
      ],
    });
    expect(report.kpis.notAppliedThc).toBe(896);
    expect(report.kpis.sentToday).toBe(890);
    expect(report.kpis.lastSentAt).toBe('2026-10-14T09:38:00Z');
    expect(report.reminders['a@b.co']).toEqual({
      sent: 2,
      lastSentAt: '2026-10-14T09:10:00Z',
      lastError: null,
    });
    expect(report.applied).toEqual(['row-1']);
    expect(report.matches[0]?.staffName).toBe('Chowdhury Moon');
  });

  it('reads nothing as zeros and empties, never a crash', () => {
    const report = parseRosterReport(null);
    expect(report.kpis.sentTotal).toBe(0);
    expect(report.kpis.lastSentAt).toBeNull();
    expect(report.daily).toEqual([]);
    expect(report.matches).toEqual([]);
    expect(report.settings).toEqual({
      enabled: true,
      switchOn: true,
      from: '10:00',
      until: '18:00',
    });
  });
});

describe('the words', () => {
  it('says whether the reminder is on, and from when — or which switch has it off', () => {
    const on = { enabled: true, switchOn: true, from: '10:00', until: '18:00' };
    expect(reminderSchedule(on)).toBe('On · daily, from 10:00 (UK time)');
    expect(remindersSending(on)).toBe(true);
    expect(reminderSchedule({ ...on, enabled: false })).toMatch(/^Off — nobody/);
    expect(reminderSchedule({ ...on, switchOn: false })).toMatch(/Settings → Notifications/);
    expect(remindersSending({ ...on, switchOn: false })).toBe(false);
  });

  it('summarises one person’s reminders', () => {
    expect(reminderSummary(undefined)).toBe('Not yet');
    expect(reminderSummary({ sent: 0, lastSentAt: null, lastError: null })).toBe('Not yet');
    expect(reminderSummary({ sent: 3, lastSentAt: '2026-10-14T09:10:00Z', lastError: null })).toBe(
      '3× · last 14 Oct 2026',
    );
  });

  it('labels the stage and the day', () => {
    expect(statusLabel('interview_requested')).toBe('Interview requested');
    expect(statusLabel('something_new')).toBe('something new');
    expect(dayLabel('2026-10-14')).toBe('Wed 14');
  });

  it('draws bars against the tallest day, and an empty fortnight flat', () => {
    expect(
      barHeights([
        { day: 'a', sent: 0, failed: 0 },
        { day: 'b', sent: 450, failed: 0 },
        { day: 'c', sent: 900, failed: 2 },
      ]),
    ).toEqual([0, 50, 100]);
    expect(barHeights([{ day: 'a', sent: 0, failed: 0 }])).toEqual([0]);
  });

  it('gives a share only when there is something to divide', () => {
    expect(share(9, 900)).toBe(1);
    expect(share(0, 0)).toBeNull();
  });
});
