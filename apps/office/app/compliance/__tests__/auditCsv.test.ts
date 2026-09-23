import { describe, expect, it } from 'vitest';
import { AUDIT_COLUMNS, auditCsv, auditFileName, csvCell, ukTimestamp } from '../auditCsv';
import type { AuditRow } from '../types';

const BASE: AuditRow = {
  id: 1,
  at: '2026-09-23T13:05:00Z',
  record_type: 'completion_letter',
  event: 'approved',
  document_id: 'd1',
  staff_id: 's1',
  employee_id: 873,
  worker: 'Amara Kalu',
  actor_name: 'Gisela M.',
  evidence_form: 'transcript',
  file_path: 's1/completion-letter/f1.pdf',
  uploaded_at: '2026-09-22T09:00:00Z',
  completion_date_claimed: '2026-10-07',
  completion_date: '2026-10-07',
  visa_expiry: '2028-03-31',
  reason: null,
  notice_days: null,
  effective_from: null,
  retain_until: null,
};

describe('AC7 — all documents and decisions are auditable and exportable', () => {
  it('AC7: exports every fact the requirement lists — document, upload time, reviewer, decision time, completion date, reasons', () => {
    const headers = AUDIT_COLUMNS.map((c) => c.header);
    for (const needed of [
      'Recorded at (UK)',
      'Event',
      'By',
      'Document ID',
      'File',
      'Uploaded at (UK)',
      'Completion date (worker)',
      'Completion date (confirmed)',
      'Visa expiry (confirmed)',
      'Rejection reason',
    ]) {
      expect(headers).toContain(needed);
    }
  });

  it('AC7: one line per event, the approval carrying who, when and the confirmed dates', () => {
    const csv = auditCsv([BASE]);
    const [head, line, trailing] = csv.split('\r\n');
    expect(head!.split(',')).toHaveLength(AUDIT_COLUMNS.length);
    expect(line).toBe(
      '2026-09-23 14:05,Completion letter,approved,873,Amara Kalu,Gisela M.,d1,transcript,s1/completion-letter/f1.pdf,2026-09-22 10:00,2026-10-07,2026-10-07,2028-03-31,,,,',
    );
    expect(trailing).toBe('');
  });

  it('AC7: carries a rejection reason and an opt-out cancellation in the same file', () => {
    const csv = auditCsv([
      {
        ...BASE,
        id: 2,
        event: 'rejected',
        reason: 'The award date is not visible, please re-upload',
      },
      {
        ...BASE,
        id: 3,
        record_type: 'wtr_optout',
        event: 'cancelled',
        document_id: null,
        evidence_form: null,
        file_path: null,
        uploaded_at: null,
        completion_date: null,
        completion_date_claimed: null,
        visa_expiry: null,
        notice_days: 7,
        effective_from: '2026-09-30',
      },
    ]);
    expect(csv).toContain('"The award date is not visible, please re-upload"');
    expect(csv).toContain('48-hour opt-out,cancelled');
    expect(csv).toContain(',7,2026-09-30,');
  });
});

describe('CSV safety', () => {
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('defuses a reason typed as a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+44 7700')).toBe("'+44 7700");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('UK time (§1.8: audit stamps are UK-only)', () => {
  it('writes BST and GMT instants as UK wall-clock time', () => {
    expect(ukTimestamp('2026-07-01T11:30:00Z')).toBe('2026-07-01 12:30');
    expect(ukTimestamp('2026-12-01T11:30:00Z')).toBe('2026-12-01 11:30');
  });

  it('names the file by the UK date', () => {
    expect(auditFileName(new Date('2026-09-23T23:30:00Z'))).toBe(
      'thc-completion-letter-audit-2026-09-24.csv',
    );
  });
});
