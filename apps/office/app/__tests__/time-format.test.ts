import { describe, expect, it } from 'vitest';
import { ukInstant } from '@thc/domain';
import { logTime } from '../checkin/log';
import { radarStatus, ukStamp as complianceStamp } from '../compliance/queue';
import { formatAsOf } from '../dashboard/view-model';
import { offerChip, ukWindowLabel, unavailableLabel } from '../events/[id]/board-model';
import { scheduledWindowLines, toEventRow } from '../events/view-model';
import {
  clientMetaLine,
  officeMetaLine,
  ukDayTime,
  ukStamp as feedbackStamp,
} from '../feedback/view-model';
import { shortStamp, ukTime } from '../onboarding/view-model';
import { formatUkStamp as reportStamp, sendStatus } from '../reports/view-model';
import { ukStampFull } from '../_lib/rtwCheck';
import {
  autosendHint,
  parseAutosendConfig,
  ukShortStamp,
} from '../api/jobs/event-documents/_lib/schedule';
import { formatLocalStamp, formatLocalTime, formatUkStamp } from '../staff/[id]/profile';
import { availabilityWhen, contactUpdatedLine } from '../staff/[id]/additions';
import { payRateSetLine } from '../staff/[id]/payRate';
import { requestedAt, ukStamp as requestStamp } from '../staff/requests/model';

/**
 * ADR-0085, the formatters. The choice changes how a time is WRITTEN —
 * "17:30" or "5:30 pm" — and nothing else: no default changes (every one of
 * these takes the format last and defaults to 24-hour), and the UK-time
 * wording around the clock (§1.8) is the same in both.
 *
 * 2026-10-05 16:30Z is 17:30 in London (BST); 2026-01-05 09:05Z is 09:05 (GMT).
 */
const EVENING = '2026-10-05T16:30:00Z';
const MORNING = '2026-01-05T09:05:00Z';

describe('/events', () => {
  const start = ukInstant('2026-09-18', '07:00');
  const end = ukInstant('2026-09-19', '01:30');

  it('writes a list row’s window and its calendar chip on the operator’s clock', () => {
    const event = {
      id: 'e1',
      title: 'Gala',
      date: '2026-09-18',
      clientId: 'c1',
      clientName: 'Leonardo',
      venueName: 'Royal',
      venueAddress: 'x',
      poNumber: '',
      cancelledAt: null,
      cancelReason: '',
      roles: [
        { roleName: 'Chef', start: '07:00', end: '15:00', headcount: 2, buffer: 0, confirmed: 2 },
        {
          roleName: 'Waiting',
          start: '17:00',
          end: '23:30',
          headcount: 2,
          buffer: 0,
          confirmed: 2,
        },
      ],
    };
    const now = new Date('2026-09-10T09:00:00Z');
    const plain = toEventRow(event, now);
    expect(plain.windowLabel).toBe('07:00 – 23:30');
    expect(plain.windowStartLabel).toBe('07:00');
    const twelve = toEventRow(event, now, '12h');
    expect(twelve.windowLabel).toBe('7:00 am – 11:30 pm');
    expect(twelve.windowStartLabel).toBe('7:00 am');
    // The stored window, and what the status is computed from, do not move.
    expect(twelve.windowIso).toEqual(plain.windowIso);
    expect(twelve.status).toBe(plain.status);
  });

  it('keeps the "your time" line for a viewer outside the UK, on the same clock', () => {
    expect(scheduledWindowLines(start, end, 'Europe/Athens', '12h')).toEqual({
      uk: '7:00 am – 1:30 am',
      local: '9:00 am – 3:30 am your time',
    });
    expect(scheduledWindowLines(start, end, 'Europe/Athens').local).toBe('09:00 – 03:30 your time');
  });

  it('writes the board’s unavailable window and offer expiry on the clock', () => {
    const morning = { startsAt: '2026-10-15T05:00:00Z', endsAt: '2026-10-15T08:00:00Z' };
    expect(ukWindowLabel(morning)).toBe('Thu 15 Oct 06:00–09:00 UK');
    expect(ukWindowLabel(morning, '12h')).toBe('Thu 15 Oct 6:00 am–9:00 am UK');
    expect(unavailableLabel([morning], '12h')).toBe(
      'Marked unavailable · Thu 15 Oct 6:00 am–9:00 am UK',
    );
    // An all-day entry is a test on UK midnight, not a label: unchanged in 12-hour.
    const allDay = { startsAt: '2026-10-14T23:00:00Z', endsAt: '2026-10-15T23:00:00Z' };
    expect(ukWindowLabel(allDay, '12h')).toBe('Thu 15 Oct · all day');
    const offer = {
      offerId: 'o',
      mode: 'pool' as const,
      expiresAt: '2026-09-20T15:00:00Z',
      note: null,
    };
    expect(offerChip(offer).label).toBe('Open to pool · until Sun 20 Sep, 16:00 UK');
    expect(offerChip(offer, '12h').label).toBe('Open to pool · until Sun 20 Sep, 4:00 pm UK');
  });

  it('writes the automatic-send hint on the clock; the job’s own config stays HH:MM', () => {
    const config = parseAutosendConfig({
      allocation: { enabled: true, time: '14:00' },
      completed: { enabled: true, time: '10:00' },
    });
    const idle = { sentAt: null, started: false, ended: false };
    expect(autosendHint('allocation', config, idle)).toBe(
      'Sent automatically the day before at 14:00 (UK time)',
    );
    expect(autosendHint('allocation', config, idle, '12h')).toBe(
      'Sent automatically the day before at 2:00 pm (UK time)',
    );
    expect(ukShortStamp('2026-09-28T13:00:04Z')).toBe('28/09 14:00');
    expect(ukShortStamp('2026-09-28T13:00:04Z', '12h')).toBe('28/09 2:00 pm');
  });
});

describe('/dashboard', () => {
  it('stamps "as of" in UK time on either clock', () => {
    expect(formatAsOf(new Date('2026-09-24T13:32:00Z')).time).toBe('14:32');
    expect(formatAsOf(new Date('2026-09-24T13:32:00Z'), '12h')).toEqual({
      time: '2:32 pm',
      date: 'Thu 24 Sep 2026',
    });
  });
});

describe('/checkin', () => {
  it('writes the log’s viewer-local time on the clock, with its day', () => {
    const now = new Date('2026-10-05T20:00:00Z');
    expect(logTime(EVENING, 'Europe/London', now)).toBe('today 17:30');
    expect(logTime(EVENING, 'Europe/London', now, '12h')).toBe('today 5:30 pm');
    expect(logTime('2026-10-01T16:30:00Z', 'Europe/London', now, '12h')).toBe('Thu 1 · 5:30 pm');
  });
});

describe('audit stamps stay UK, on either clock (§1.8)', () => {
  it('staff profile', () => {
    expect(formatUkStamp(EVENING)).toBe('05.10.2026 17:30 UK time');
    expect(formatUkStamp(EVENING, '12h')).toBe('05.10.2026 5:30 pm UK time');
    expect(formatUkStamp(MORNING, '12h')).toBe('05.01.2026 9:05 am UK time');
    expect(formatUkStamp(null, '12h')).toBe('—');
    expect(payRateSetLine({ set_at: EVENING }, '12h')).toBe('Set 05.10.2026 5:30 pm UK time');
  });

  it('a profile’s own-zone stamps follow the clock as well', () => {
    expect(formatLocalStamp(EVENING, 'Europe/London')).toBe('Mon 05 Oct · 17:30');
    expect(formatLocalStamp(EVENING, 'Europe/London', '12h')).toBe('Mon 05 Oct · 5:30 pm');
    expect(formatLocalTime(null, '12h')).toBe('—');
  });

  it('availability, the emergency contact line and the change requests', () => {
    const entry = {
      starts_at: '2026-10-01T17:00:00Z',
      ends_at: '2026-10-01T22:00:00Z',
      all_day: false,
    };
    expect(availabilityWhen(entry)).toBe('Thu 1 Oct · 18:00 – 23:00');
    expect(availabilityWhen(entry, '12h')).toBe('Thu 1 Oct · 6:00 pm – 11:00 pm');
    const contact = { updatedAt: EVENING, updatedBy: 'worker' as const, updatedByName: null };
    expect(contactUpdatedLine(contact, '12h')).toBe('05.10.2026 5:30 pm UK time · by the worker');
    expect(requestedAt('2026-09-18T13:37:00Z', '12h')).toBe('Fri 18 Sep · 2:37 pm UK time');
    expect(requestStamp(EVENING, '12h')).toBe('05.10.2026 5:30 pm UK time');
  });

  it('compliance, the RTW check and the report sends', () => {
    expect(complianceStamp('2026-09-13T14:02:00Z')).toBe('13 Sep 15:02');
    expect(complianceStamp('2026-09-13T14:02:00Z', '12h')).toBe('13 Sep 3:02 pm');
    const expired = { state: 'expired', days_left: 0 } as Parameters<typeof radarStatus>[0];
    expect(radarStatus(expired).label).toBe('Expires today · blocked 05:00');
    expect(radarStatus(expired, '12h').label).toBe('Expires today · blocked 5:00 am');
    expect(ukStampFull(EVENING)).toBe('05.10.2026 17:30 UK time');
    expect(ukStampFull(EVENING, '12h')).toBe('05.10.2026 5:30 pm UK time');
    expect(reportStamp('2026-01-05T09:00:00Z')).toBe('Mon 05 Jan, 09:00');
    expect(reportStamp('2026-01-05T09:00:00Z', '12h')).toBe('Mon 05 Jan, 9:00 am');
    const send = { status: 'sent', sent_at: '2026-01-05T09:00:00Z' } as Parameters<
      typeof sendStatus
    >[0];
    expect(sendStatus(send)?.text).toBe('Last sent: Mon 05 Jan, 09:00');
    expect(sendStatus(send, '12h')?.text).toBe('Last sent: Mon 05 Jan, 9:00 am');
  });

  it('feedback and onboarding', () => {
    expect(ukDayTime('2026-09-18T08:12:00Z')).toBe('Fri 18 Sep 09:12');
    expect(ukDayTime('2026-09-18T08:12:00Z', '12h')).toBe('Fri 18 Sep 9:12 am');
    expect(feedbackStamp('2026-09-17T22:50:00Z', '12h')).toBe('17 Sep 2026 · 11:50 pm');
    const entry = {
      created_at: '2026-09-18T08:12:00Z',
      updated_at: null,
      author_name: 'Sophie L.',
      client_name: 'Leonardo',
      staff_removed: false,
      staff_removed_at: null,
    } as Parameters<typeof clientMetaLine>[0];
    expect(clientMetaLine(entry, '12h')).toBe(
      'from Sophie L. (client) · submitted Fri 18 Sep 9:12 am',
    );
    expect(officeMetaLine(entry, '12h')).toBe('18 Sep 2026 · 9:12 am');
    expect(ukTime('2026-09-18T17:44:00Z')).toBe('18:44');
    expect(ukTime('2026-09-18T17:44:00Z', '12h')).toBe('6:44 pm');
    expect(shortStamp('2026-09-15T09:02:00Z', '12h')).toBe('15 Sep 10:02 am');
  });
});
