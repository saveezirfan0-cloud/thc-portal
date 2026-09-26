import { describe, expect, it } from 'vitest';
import {
  canApprove,
  changeSummary,
  decidedBy,
  decisionLabel,
  decisionMessage,
  evidenceName,
  nameBefore,
  oldestFirst,
  requestedAt,
} from '../model';
import type { ChangeRequestRow } from '../types';

/** ADR-0045 — the change-request queue's presentation rules. */
const row = (over: Partial<ChangeRequestRow> = {}): ChangeRequestRow => ({
  id: 'r1',
  staff_id: 's1',
  kind: 'name',
  status: 'pending',
  display_name: 'Amara Kalu',
  employee_id: 873,
  removed: false,
  staff_status: 'compliant',
  rtw_branch: 'uk_irish',
  right_to_work_until: null,
  current_first_name: 'Amara',
  current_last_name: 'Kalu',
  current_photo_path: null,
  proposed_first_name: 'Amara',
  proposed_last_name: 'Okafor',
  proposed_photo_path: null,
  evidence_path: 's1/change-requests/marriage-certificate.jpg',
  worker_note: null,
  previous_value: null,
  created_at: '2026-09-18T13:37:00Z',
  decided_at: null,
  decided_by_name: null,
  decision_reason: null,
  ...over,
});

describe('change requests — what the office reads', () => {
  it('reads a pending name as now → requested', () => {
    expect(changeSummary(row())).toBe('Amara Kalu → Amara Okafor');
  });

  it('reads a DECIDED name against the snapshot, not the profile it changed', () => {
    // After approval the profile already says Okafor; "now" must be the
    // name the decision replaced (previous_value), or the row reads
    // "Amara Okafor → Amara Okafor".
    const approved = row({
      status: 'approved',
      current_last_name: 'Okafor',
      previous_value: { firstName: 'Amara', lastName: 'Kalu' },
    });
    expect(nameBefore(approved)).toBe('Amara Kalu');
    expect(changeSummary(approved)).toBe('Amara Kalu → Amara Okafor');
  });

  it('says "new photo" for a photo and "anonymised" for a removed worker (§1.7)', () => {
    expect(changeSummary(row({ kind: 'photo' }))).toBe('new photo');
    expect(changeSummary(row({ removed: true }))).toBe('— anonymised');
  });

  it('names the manager, the worker or the removal as who closed it', () => {
    expect(decidedBy(row({ status: 'approved', decided_by_name: 'Gisela M.' }))).toBe('Gisela M.');
    expect(decidedBy(row({ status: 'withdrawn' }))).toBe('— the worker');
    expect(decidedBy(row({ status: 'withdrawn', removed: true }))).toBe('GDPR removal');
  });

  it('labels the decision in the wireframe’s words', () => {
    expect(decisionLabel('approved')).toEqual({ label: 'Approved', tone: 'green' });
    expect(decisionLabel('rejected')).toEqual({ label: 'Rejected', tone: 'coral' });
    expect(decisionLabel('withdrawn').label).toBe('Withdrawn');
  });

  it('stamps the request in UK time (§1.8)', () => {
    expect(requestedAt('2026-09-18T13:37:00Z')).toBe('Fri 18 Sep · 14:37 UK time');
  });

  it('links the evidence by its file name', () => {
    expect(evidenceName('s1/change-requests/marriage-certificate.jpg')).toBe(
      'marriage-certificate.jpg',
    );
    expect(evidenceName(null)).toBeNull();
  });

  it('queues oldest first', () => {
    const rows = [
      row({ id: 'b', created_at: '2026-09-18T13:37:00Z' }),
      row({ id: 'a', created_at: '2026-09-17T08:12:00Z' }),
    ];
    expect(oldestFirst(rows).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('change requests — the decision', () => {
  it('approves a name only with the evidence tick; a photo needs none', () => {
    expect(canApprove('name', false)).toBe(false);
    expect(canApprove('name', true)).toBe(true);
    expect(canApprove('photo', false)).toBe(true);
  });

  it('turns the database refusals into words a manager can act on', () => {
    expect(decisionMessage('already_decided')).toMatch(/already been decided/);
    expect(decisionMessage('reason_required')).toMatch(/worker is shown it/);
    expect(decisionMessage('something unexpected')).toBe('something unexpected');
  });
});
