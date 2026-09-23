import { describe, expect, it } from 'vitest';
import {
  exportHref,
  formatUkStamp,
  lastWeek,
  maskNi,
  newStarterPeriod,
  parseReportView,
  periodLabel,
  pounds,
  reportHref,
  sendStatus,
  showForecastLabel,
  thisWeek,
} from '../view-model';
import type { ReportSend } from '../view-model';

// The wireframe anchor, 18 Sep 2026 (the wireframes call it a Thursday; on the real
// calendar it is a Friday, and these tests use the real calendar).
const ANCHOR = '2026-09-18';

describe('which week a tab opens on (§9.9)', () => {
  it('Financial defaults to the current Mon–Sun week', () => {
    expect(thisWeek(ANCHOR)).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(parseReportView({}, ANCHOR)).toMatchObject({
      tab: 'financial',
      from: '2026-09-14',
      to: '2026-09-20',
    });
  });

  it('"Last week" sets Mon–Sun of the previous week itself', () => {
    expect(lastWeek(ANCHOR)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(parseReportView({ tab: 'payroll' }, ANCHOR)).toMatchObject({
      from: '2026-09-07',
      to: '2026-09-13',
    });
    // On a Monday "last week" is the week that just ended, not the one before.
    expect(lastWeek('2026-09-14')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('New Starter: picking Tue 15 Sep previews Mon 7 – Sun 13 Sep', () => {
    expect(newStarterPeriod('2026-09-15')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('accepts an arbitrary range, swaps a backwards one and ignores garbage', () => {
    expect(
      parseReportView({ tab: 'payroll', from: '2026-09-20', to: '2026-09-01' }, ANCHOR),
    ).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-20',
    });
    expect(parseReportView({ from: '2026-02-30', to: 'x' }, ANCHOR)).toMatchObject({
      from: '2026-09-14',
      to: '2026-09-20',
    });
  });

  it('round-trips through the URL', () => {
    const view = parseReportView(
      { tab: 'financial', from: '2026-09-01', to: '2026-09-30', by: 'client' },
      ANCHOR,
    );
    expect(reportHref(view)).toBe('/reports?tab=financial&from=2026-09-01&to=2026-09-30&by=client');
    expect(exportHref({ ...view, tab: 'newstarter' })).toBe(
      `/reports/export?report=newstarter&date=${ANCHOR}`,
    );
  });
});

describe('"Forecast for the period" (§9.9, confirmed 28.07.2026)', () => {
  const current = thisWeek(ANCHOR);
  const previous = lastWeek(ANCHOR);

  it('shows for the current week', () => {
    expect(showForecastLabel(current.from, current.to, ANCHOR)).toBe(true);
  });

  it('shows for the previous week on Monday and Tuesday…', () => {
    const p = lastWeek('2026-09-14');
    expect(showForecastLabel(p.from, p.to, '2026-09-14')).toBe(true);
    expect(showForecastLabel(p.from, p.to, '2026-09-15')).toBe(true);
  });

  it('…and is gone from Wednesday morning', () => {
    const p = lastWeek('2026-09-16');
    expect(showForecastLabel(p.from, p.to, '2026-09-16')).toBe(false);
    expect(showForecastLabel(previous.from, previous.to, ANCHOR)).toBe(false);
  });

  it('never shows for a week two back, even on a Monday', () => {
    expect(showForecastLabel('2026-08-31', '2026-09-06', '2026-09-14')).toBe(false);
  });

  it('shows for a future week', () => {
    expect(showForecastLabel('2026-10-05', '2026-10-11', ANCHOR)).toBe(true);
  });
});

describe('send status (§9.9)', () => {
  const base: ReportSend = {
    id: 1,
    kind: 'payroll',
    period_start: '2026-09-07',
    period_end: '2026-09-13',
    status: 'sent',
    sent_at: '2026-09-14T08:00:00Z',
    created_at: '2026-09-14T08:00:00Z',
    row_count: 486,
    held_count: 1,
    error: null,
  };

  it('reads "Last sent: [date], [time]" in UK time', () => {
    expect(sendStatus(base)).toEqual({ tone: 'ok', text: 'Last sent: Mon 14 Sep, 09:00' });
  });

  it('reads "Failed to send report"', () => {
    expect(sendStatus({ ...base, status: 'failed' })).toEqual({
      tone: 'fail',
      text: 'Failed to send report',
    });
  });

  it('reads "No new: [date], [time]" for a New Starter week with nobody new — not a failure', () => {
    expect(sendStatus({ ...base, kind: 'new_starter', status: 'no_new' })).toEqual({
      tone: 'none',
      text: 'No new: Mon 14 Sep, 09:00',
    });
  });

  it('does not claim "sent" for an email still waiting for the mail sender', () => {
    expect(sendStatus({ ...base, status: 'queued', sent_at: null }).text).toMatch(
      /^Queued: Mon 14 Sep, 09:00/,
    );
  });

  it('formats a winter stamp in GMT and a summer one in BST', () => {
    expect(formatUkStamp('2026-01-05T09:00:00Z')).toBe('Mon 05 Jan, 09:00');
    expect(formatUkStamp('2026-06-01T08:00:00Z')).toBe('Mon 01 Jun, 09:00');
  });
});

describe('figures', () => {
  it('writes money to the penny from a numeric string', () => {
    expect(pounds('1072.69')).toBe('£1,072.69');
  });

  it('masks the NI number on screen, keeping the last two characters', () => {
    expect(maskNi('QQ 12 34 56 A')).toBe('●●●●●●●6A');
    expect(maskNi(null)).toBeNull();
  });

  it('labels a period the way the wireframe does', () => {
    expect(periodLabel('2026-09-08', '2026-09-14')).toBe('Tue 8 – Mon 14 Sep');
    expect(periodLabel('2026-09-07', '2026-09-13')).toBe('Mon 7 – Sun 13 Sep');
    expect(periodLabel('2026-09-28', '2026-10-04')).toBe('Mon 28 Sep – Sun 4 Oct');
  });
});
