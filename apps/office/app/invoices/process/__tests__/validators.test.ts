import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  isIsoDate,
  mimeFor,
  parseGroups,
  safeFileName,
  sizeLabel,
  storagePathFor,
  validateFiles,
  validateGroups,
} from '../validators';
import type { ConfirmedGroup } from '../types';

const file = (name: string, size = 1000) => ({ name, size });

describe('upload validation (ADR-0210 · audit §2.2)', () => {
  it('accepts spreadsheets, PDFs and images up to 25 MB', () => {
    expect(
      validateFiles([
        file('WC 12.10.26.xlsx'),
        file('old.XLS'),
        file('hours.csv'),
        file('scan.pdf', MAX_FILE_BYTES),
        file('photo.JPG'),
        file('photo.jpeg'),
        file('photo.png'),
      ]),
    ).toEqual([]);
  });

  it('refuses nothing chosen, too many files, other types, empty and oversize files', () => {
    expect(validateFiles([])).toEqual(['Choose at least one timesheet file.']);
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`f${i}.pdf`));
    expect(validateFiles(many)[0]).toContain('up to 10 files');
    expect(validateFiles([file('notes.docx')])[0]).toContain('only Excel, CSV, PDF, JPG and PNG');
    expect(validateFiles([file('x.pdf', 0)])[0]).toContain('empty');
    expect(validateFiles([file('big.pdf', MAX_FILE_BYTES + 1)])[0]).toContain(
      'over the 25 MB limit',
    );
  });

  it('names every bad file, not just the first', () => {
    const errors = validateFiles([file('a.exe'), file('b.pdf'), file('c.zip')]);
    expect(errors).toHaveLength(2);
  });

  it('stores a safe name and a type from the extension', () => {
    expect(safeFileName("Leonardo St Paul's Time w-c 12-10-26 (12th to 14th).pdf")).toBe(
      'Leonardo-St-Paul-s-Time-w-c-12-10-26-12th-to-14th.pdf',
    );
    expect(safeFileName('../../etc/passwd.xlsx')).toBe('passwd.xlsx');
    expect(safeFileName('.pdf')).toBe('file.pdf');
    expect(storagePathFor('J', 'F', 'a b.csv')).toBe('timesheet-jobs/J/F-a-b.csv');
    expect(mimeFor('x.csv')).toBe('text/csv');
    expect(mimeFor('x.unknown')).toBe('application/octet-stream');
    expect(sizeLabel(25 * 1024 * 1024)).toBe('25.0 MB');
  });
});

const group = (over: Partial<ConfirmedGroup> = {}): ConfirmedGroup => ({
  poNumber: '52257014',
  invoiceDate: '2026-10-26',
  eventDateStart: '2026-10-19',
  eventDateEnd: '2026-10-21',
  format: 'aggregated',
  shiftIds: ['a', 'b'],
  ...over,
});

describe('Confirm validation (mirrors timesheet_job_confirm)', () => {
  const rules = { poRequired: true, approvedIds: ['a', 'b'] };

  it('passes a complete single group', () => {
    expect(validateGroups([group()], rules)).toEqual([]);
  });

  it('needs at least one group', () => {
    expect(validateGroups([], rules)[0]!.message).toContain('nothing to invoice');
  });

  it('requires a PO when the client does, and only then', () => {
    expect(validateGroups([group({ poNumber: '  ' })], rules)[0]).toMatchObject({
      group: 0,
      message: expect.stringContaining('needs a PO number'),
    });
    expect(validateGroups([group({ poNumber: '' })], { ...rules, poRequired: false })).toEqual([]);
  });

  it('refuses empty groups, reversed dates and a bad invoice date', () => {
    const messages = validateGroups(
      [group({ shiftIds: [], eventDateStart: '2026-10-22', invoiceDate: '26/10/2026' })],
      { poRequired: false, approvedIds: [] },
    ).map((p) => p.message);
    expect(messages.some((m) => m.includes('no rows'))).toBe(true);
    expect(messages.some((m) => m.includes('invoice date'))).toBe(true);
    expect(messages.some((m) => m.includes('backwards'))).toBe(true);
  });

  it('refuses a row in two groups, a row not approved, and an approved row left out', () => {
    const problems = validateGroups(
      [group({ shiftIds: ['a', 'x'] }), group({ poNumber: 'P2', shiftIds: ['a'] })],
      rules,
    ).map((p) => p.message);
    expect(problems.some((m) => m.includes('in two invoices'))).toBe(true);
    expect(problems.some((m) => m.includes('no longer approved'))).toBe(true);
    expect(problems.some((m) => m.includes('1 approved row is not in any invoice'))).toBe(true);
  });

  it('reads real dates only', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-10-19')).toBe(true);
    expect(isIsoDate('19/10/2026')).toBe(false);
  });

  it('normalises what the browser sent', () => {
    expect(parseGroups([{ poNumber: ' P1 ', shiftIds: ['a'], format: 'weird' }], 'named')).toEqual([
      {
        poNumber: 'P1',
        invoiceDate: '',
        eventDateStart: '',
        eventDateEnd: '',
        format: 'named',
        shiftIds: ['a'],
      },
    ]);
    expect(parseGroups('nope', 'named')).toBeNull();
    expect(parseGroups([{ shiftIds: [1] }], 'named')).toBeNull();
  });
});
