import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { runExtraction, type ExtractStore, type FileRecord, type InsertedRow } from '../index';
import { isExcluded, toShiftInsert, type ShiftInsert } from '../normalise';
import {
  createAnthropicScanReader,
  normaliseScanResult,
  type MessagesClient,
  type ScanReader,
} from '../scan';
import { parseGenericSheet, parseTasterWorkbook, parseWorkbook, weekFromFileName } from '../sheets';
import { hhmmToHours, parseBreakMin, parseClock, parseUkDate, splitStaffRef } from '../values';
import { parseCsv, readXlsx, spreadsheetKind } from '../workbook';

const TASTER_HEADERS = [
  'First name',
  'Last name',
  'Total work hours',
  'Total paid breaks',
  'Total paid hours',
  'Regular',
  'Digital Hours',
  'Regular',
  'Total overtime',
  'Overtime',
  'Total unpaid breaks',
  'Total paid time off hours',
  'Total unpaid time off hours',
  'Total pay GBP',
  'Worked days',
  '15 minute break',
  'Mobile phone',
  'Start date',
  'End date',
];

async function tasterBook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const all = wb.addWorksheet('All Employees');
  all.addRow(['Weekly report']);
  all.addRow(TASTER_HEADERS);
  const row = (first: string, last: string, work: string, paid: string, start: string) => {
    const r = new Array(19).fill(null);
    r[0] = first;
    r[1] = last;
    r[2] = work;
    r[4] = paid;
    r[17] = start;
    r[18] = '18/10/2026';
    return r;
  };
  all.addRow(row('Test', 'Alpha (1001)', '25:14', '25:14', '12/10/2026'));
  all.addRow(row('Test', 'Bravo (1002)', '8:00', '7:30', '12/10/2026'));
  all.addRow(row('Test', 'Zero (1003)', '0:00', '0:00', '12/10/2026'));
  all.addRow(['Total']);
  wb.addWorksheet('Test Alpha (1001)').addRow(['Date', 'Hours']);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('values', () => {
  it('converts hh:mm to 2 dp decimals', () => {
    expect(hhmmToHours('25:14')).toBe(25.23);
    expect(hhmmToHours('7:30')).toBe(7.5);
    expect(hhmmToHours('0:20')).toBe(0.33);
    expect(hhmmToHours('7.5')).toBe(7.5);
    expect(hhmmToHours(' 7h 30m ')).toBe(7.5);
    expect(hhmmToHours('abc')).toBeNull();
    expect(hhmmToHours('')).toBeNull();
    expect(hhmmToHours(null)).toBeNull();
  });
  it('reads UK dates day-first', () => {
    expect(parseUkDate('12/10/26')).toBe('2026-10-12');
    expect(parseUkDate('03/04/2027')).toBe('2027-04-03');
    expect(parseUkDate('12.10.26')).toBe('2026-10-12');
    expect(parseUkDate('15th Oct 2026')).toBe('2026-10-15');
    expect(parseUkDate('2026-10-12')).toBe('2026-10-12');
    expect(parseUkDate('31/02/26')).toBeNull();
    expect(parseUkDate('13/13/26')).toBeNull();
    expect(parseUkDate(new Date(Date.UTC(2026, 9, 12)))).toBe('2026-10-12');
  });
  it('reads clocks, breaks and staff refs', () => {
    expect(parseClock('9:30')).toBe('09:30');
    expect(parseClock('5pm')).toBe('17:00');
    expect(parseClock('12am')).toBe('00:00');
    expect(parseClock('0930')).toBe('09:30');
    expect(parseClock(0.5)).toBe('12:00');
    expect(parseClock('25:00')).toBeNull();
    expect(parseBreakMin('30 mins')).toBe(30);
    expect(parseBreakMin('0:30')).toBe(30);
    expect(parseBreakMin('')).toBe(0);
    expect(parseBreakMin('lots')).toBeNull();
    expect(splitStaffRef('Ana (1234)')).toEqual({ name: 'Ana', ref: '1234' });
    expect(splitStaffRef('Ana Costa')).toEqual({ name: 'Ana Costa', ref: null });
  });
});

describe('Taster workbook', () => {
  it('gives one weekly row per person from All Employees, preferring paid hours', async () => {
    const grids = await readXlsx(await tasterBook());
    const res = parseWorkbook(grids, 'WC 12.10.26 Oxford Circus.xlsx');
    expect(res.rows).toHaveLength(2); // the zero-hours person and the Total line are skipped
    const [a, b] = res.rows;
    expect(a).toMatchObject({
      staffName: 'Test Alpha',
      staffRef: '1001',
      workDate: '2026-10-12',
      hours: 25.23,
      startTime: null,
      endTime: null,
      confidence: null,
      source: { type: 'excel', sheet: 'All Employees', row: 3 },
    });
    expect(b).toMatchObject({ staffName: 'Test Bravo', hours: 7.5 }); // paid 7:30, not work 8:00
    expect(res.sheets).toEqual(['All Employees']);
  });

  it('falls back to the file name week when Start date is missing', () => {
    const res = parseTasterWorkbook(
      [
        {
          name: 'All Employees',
          rows: [
            ['First name', 'Last name', 'Total paid hours'],
            ['A', 'B', '4:00'],
          ],
        },
      ],
      { weekCommencing: weekFromFileName('Alltaster WC 12.10.26 Spud Force.xlsx') },
    );
    expect(res.rows[0]).toMatchObject({ workDate: '2026-10-12', hours: 4 });
  });

  it('derives from per-person sheets when All Employees is missing (Spud Force)', () => {
    const res = parseWorkbook(
      [
        {
          name: 'Test Person (77)',
          rows: [
            ['Date', 'Start', 'End', 'Break'],
            ['12/10/26', '09:00', '17:30', '30'],
          ],
        },
        { name: 'Notes', rows: [['nothing here']] },
      ],
      'Alltaster WC 12.10.26 Spud Force.xlsx',
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      staffName: 'Test Person',
      staffRef: '77',
      workDate: '2026-10-12',
      startTime: '09:00',
      endTime: '17:30',
      breakMin: 30,
    });
  });

  it('flags an unreadable hours cell instead of dropping the person', () => {
    const res = parseTasterWorkbook([
      {
        name: 'All Employees',
        rows: [
          ['First name', 'Last name', 'Total paid hours', 'Start date'],
          ['A', 'B', 'n/a', '12/10/2026'],
        ],
      },
    ]);
    expect(res.rows[0]!.problems).toContain('unreadable_hours');
    expect(res.rows[0]!.hours).toBeNull();
  });
});

describe('generic sheet', () => {
  it('detects the header by aliases and reads times', () => {
    const res = parseGenericSheet({
      name: 'Sheet1',
      rows: [
        ['Hospitality sheet'],
        ['Employee', 'ID', 'Shift date', 'Position', 'Time in', 'Time out', 'Break (min)'],
        ['Test One', 'S1', '15/10/26', 'KP', '18:00', '02:00', '30'],
        [null, null, null, null, null, null, null],
        ['Total'],
      ],
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      staffName: 'Test One',
      staffRef: 'S1',
      workDate: '2026-10-15',
      roleName: 'KP',
      startTime: '18:00',
      endTime: '02:00',
      breakMin: 30,
      hours: null,
      source: { type: 'excel', sheet: 'Sheet1', row: 3 },
    });
  });
  it('uses an hours column when there are no times', () => {
    const res = parseGenericSheet({
      name: 'S',
      rows: [
        ['Name', 'Date', 'Hours'],
        ['Test Two', '13/10/26', '6:15'],
      ],
    });
    expect(res.rows[0]).toMatchObject({ hours: 6.25, startTime: null });
  });
  it('reports a missing header', () => {
    expect(parseGenericSheet({ name: 'S', rows: [['x', 'y']] }).problems).toContain(
      'header_not_found',
    );
  });
});

describe('csv and kinds', () => {
  it('parses quoted csv', () => {
    expect(parseCsv('Name,Date\r\n"Smith, A",12/10/26\n')).toEqual([
      ['Name', 'Date'],
      ['Smith, A', '12/10/26'],
    ]);
  });
  it('picks a reader by extension/mime', () => {
    expect(spreadsheetKind('a.CSV', 'application/vnd.ms-excel')).toBe('csv');
    expect(spreadsheetKind('a.xlsx', 'application/octet-stream')).toBe('xlsx');
    expect(spreadsheetKind('a.xls', 'application/vnd.ms-excel')).toBe('xls');
    expect(spreadsheetKind('a.pdf', 'application/pdf')).toBeNull();
  });
});

describe('normalise', () => {
  const base = {
    staffName: 'Test Alpha',
    staffRef: null,
    workDate: '2026-10-12',
    roleName: null,
    startTime: null,
    endTime: null,
    breakMin: 0,
    hours: 5,
    confidence: null,
    original: {},
    source: { type: 'excel' as const, sheet: 'S', row: 1 },
    problems: [],
  };
  const ctx = { jobId: 'j', fileId: 'f', sort: 3, excludedStaff: ['ingrid'] };
  it('matches excluded staff case-insensitively on word boundaries', () => {
    expect(isExcluded('Ingrid Larsen', ['Ingrid'])).toBe(true);
    expect(isExcluded('INGRID', ['ingrid'])).toBe(true);
    expect(isExcluded('Ingrida Z', ['Ingrid'])).toBe(false);
  });
  it('statuses: extracted, flagged (confidence/problems), rejected (excluded)', () => {
    expect(toShiftInsert(base, ctx).status).toBe('extracted');
    expect(toShiftInsert({ ...base, confidence: 0.74 }, ctx).status).toBe('flagged');
    expect(toShiftInsert({ ...base, confidence: 0.75 }, ctx).status).toBe('extracted');
    expect(toShiftInsert({ ...base, problems: ['x'] }, ctx).status).toBe('flagged');
    expect(toShiftInsert({ ...base, workDate: null }, ctx).status).toBe('flagged');
    expect(toShiftInsert({ ...base, staffName: 'Ingrid Larsen' }, ctx).status).toBe('rejected');
  });
  it('leaves role null and does not set hours when times exist', () => {
    const r = toShiftInsert({ ...base, startTime: '09:00', endTime: '17:00', hours: 8 }, ctx);
    expect(r.role_name).toBeNull();
    expect(r.hours).toBeNull();
    expect(r).toMatchObject({ job_id: 'j', file_id: 'f', sort: 3, kind: 'shift' });
  });
});

describe('scan', () => {
  it('normalises, repairs and caps doubtful rows; never invents', () => {
    const rows = normaliseScanResult({
      rows: [
        {
          name: 'Test A',
          staffId: null,
          dateText: '15/10/26',
          role: 'Waiting',
          startTime: '18:00',
          endTime: '23:30',
          breakMinutes: 30,
          confidence: 0.93,
          page: 1,
          box: [0.1, 0.2, 0.9, 0.25],
        },
        {
          name: 'Test B',
          staffId: null,
          dateText: '32/10/26',
          role: null,
          startTime: '18:00',
          endTime: null,
          breakMinutes: null,
          confidence: 0.9,
          page: 2,
          box: null,
        },
        {
          name: null,
          staffId: null,
          dateText: null,
          role: null,
          startTime: null,
          endTime: null,
          breakMinutes: null,
          confidence: 0.2,
          page: 1,
          box: null,
        },
      ],
      notes: '',
    });
    expect(rows).toHaveLength(2); // the empty row is dropped
    expect(rows[0]).toMatchObject({
      staffName: 'Test A',
      workDate: '2026-10-15',
      startTime: '18:00',
      endTime: '23:30',
      breakMin: 30,
      confidence: 0.93,
      source: { type: 'pdf-table', page: 1, bbox: [0.1, 0.2, 0.9, 0.25] },
    });
    expect(rows[1]!.workDate).toBeNull();
    expect(rows[1]!.confidence).toBeLessThanOrEqual(0.5);
    expect(rows[1]!.problems).toEqual(expect.arrayContaining(['unreadable_date', 'missing_time']));
    expect(
      toShiftInsert(rows[1]!, { jobId: 'j', fileId: null, sort: 0, excludedStaff: [] }).status,
    ).toBe('flagged');
  });

  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const fakeClient = (text: string, stop = 'end_turn'): MessagesClient & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      calls,
      messages: {
        create: async (body) => {
          calls.push(body);
          return { id: 'm', stop_reason: stop, content: [{ type: 'text', text }] } as never;
        },
      },
    };
  };

  it('sends a document block with the structured schema and parses the answer', async () => {
    const client = fakeClient(
      JSON.stringify({
        rows: [
          {
            name: 'T',
            staffId: null,
            dateText: '1/10/26',
            role: null,
            startTime: '9:00',
            endTime: '17:00',
            breakMinutes: 0,
            confidence: 0.9,
            page: 1,
            box: null,
          },
        ],
        notes: '',
      }),
    );
    const res = await createAnthropicScanReader({ client, model: 'claude-sonnet-5' }).read({
      bytes: pdf,
      mimeType: 'application/pdf',
      fileName: 'a.pdf',
    });
    expect(res.ok && res.rows).toHaveLength(1);
    const body = client.calls[0] as {
      model: string;
      messages: { content: { type: string }[] }[];
      output_config: { format: { type: string } };
    };
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.messages[0]!.content[0]!.type).toBe('document');
    expect(body.output_config.format.type).toBe('json_schema');
  });
  it('returns codes, not exceptions', async () => {
    const read = (c: MessagesClient, bytes = pdf, mime = 'application/pdf') =>
      createAnthropicScanReader({ client: c }).read({ bytes, mimeType: mime, fileName: 'a' });
    expect(await read(fakeClient('not json'))).toEqual({ ok: false, code: 'unparseable_answer' });
    expect(await read(fakeClient('{}', 'max_tokens'))).toEqual({
      ok: false,
      code: 'too_many_rows',
    });
    expect(await read(fakeClient('{}'), new Uint8Array([1, 2, 3]), 'image/heic')).toEqual({
      ok: false,
      code: 'unsupported_input:heic',
    });
    const boom: MessagesClient = {
      messages: { create: () => Promise.reject(new Error('secret detail')) },
    };
    expect(await read(boom)).toEqual({ ok: false, code: 'unexpected_error' });
  });
  it('is off without a key', async () => {
    const prev = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    const res = await createAnthropicScanReader().read({
      bytes: pdf,
      mimeType: 'application/pdf',
      fileName: 'a.pdf',
    });
    expect(res).toEqual({ ok: false, code: 'ai_not_configured' });
    if (prev !== undefined) process.env['ANTHROPIC_API_KEY'] = prev;
  });
});

describe('runExtraction', () => {
  function fakeStore(
    over: {
      status?: string;
      files?: FileRecord[];
      blobs?: Record<string, Uint8Array>;
      notes?: string | null;
    } = {},
  ) {
    const state = {
      inserted: [] as ShiftInsert[],
      deleted: 0,
      flagged: [] as string[],
      finish: undefined as undefined | { status: string; notes?: string; error?: string },
      claimed: false,
    };
    const store: ExtractStore = {
      loadJob: async () => ({
        id: 'job',
        client_id: 'cl',
        status: over.status ?? 'uploaded',
        notes: over.notes ?? null,
      }),
      claim: async () => ((state.claimed = true), true),
      loadClient: async () => ({
        timesheet_default_role: 'Service Staff',
        timesheet_excluded_staff: ['Test Bravo'],
        invoice_format: 'named',
      }),
      loadFiles: async () => over.files ?? [],
      download: async (p) => {
        const b = over.blobs?.[p];
        if (!b) throw new Error('missing');
        return b;
      },
      deleteExtracted: async () => void state.deleted++,
      insert: async (rows) => {
        state.inserted.push(...rows);
        return rows.map((r, i): InsertedRow => ({
          id: `id${state.inserted.length}-${i}`,
          status: r.status,
          issues: r.hours === 5 ? ['no_rate'] : [],
        }));
      },
      flag: async (ids) => void state.flagged.push(...ids),
      finish: async (_id, patch) => void (state.finish = patch),
    };
    return { store, state };
  }

  it('extracts a Taster workbook into reviewing, rejecting excluded staff', async () => {
    const { store, state } = fakeStore({
      files: [
        {
          id: 'f1',
          storage_path: 'p1',
          file_name: 'WC 12.10.26 Oxford Circus.xlsx',
          mime_type: 'application/octet-stream',
        },
      ],
      blobs: { p1: await tasterBook() },
    });
    await runExtraction('job', { store });
    expect(state.finish?.status).toBe('reviewing');
    expect(state.finish?.notes).toMatch(/^Extracted 2 rows from 1 file/);
    expect(state.deleted).toBe(1);
    expect(state.inserted.map((r) => [r.staff_name, r.status, r.sort, r.file_id])).toEqual([
      ['Test Alpha', 'extracted', 0, 'f1'],
      ['Test Bravo', 'rejected', 1, 'f1'],
    ]);
  });

  it('keeps existing notes and flags rows the trigger found issues on', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('All Employees').addRows([
      ['First name', 'Last name', 'Total paid hours', 'Start date'],
      ['T', 'One', '5:00', '12/10/2026'],
    ]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const { store, state } = fakeStore({
      notes: 'PO 123',
      files: [{ id: 'f', storage_path: 'p', file_name: 'a.xlsx', mime_type: 'x' }],
      blobs: { p: bytes },
    });
    await runExtraction('job', { store });
    expect(state.finish).toEqual({ status: 'reviewing' });
    expect(state.flagged).toHaveLength(1);
  });

  it('reads a scan through the injected reader', async () => {
    const reader: ScanReader = {
      read: vi.fn(async () => ({
        ok: true as const,
        model: 'm',
        rows: normaliseScanResult({
          rows: [
            {
              name: 'Test A',
              staffId: null,
              dateText: '15/10/26',
              role: 'Waiting',
              startTime: '18:00',
              endTime: '23:00',
              breakMinutes: 0,
              confidence: 0.6,
              page: 1,
              box: null,
            },
          ],
          notes: '',
        }),
      })),
    };
    const { store, state } = fakeStore({
      status: 'error',
      files: [{ id: 'f', storage_path: 'p', file_name: 'scan.pdf', mime_type: 'application/pdf' }],
      blobs: { p: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    });
    await runExtraction('job', { store, scanReader: reader });
    expect(state.finish?.status).toBe('reviewing');
    expect(state.inserted[0]).toMatchObject({
      status: 'flagged',
      confidence: 0.6,
      source: { type: 'pdf-table', page: 1 },
    });
  });

  it('sets error with a short code and inserts nothing on failure', async () => {
    const reader: ScanReader = { read: async () => ({ ok: false, code: 'timeout' }) };
    const { store, state } = fakeStore({
      files: [{ id: 'f', storage_path: 'p', file_name: 'scan.pdf', mime_type: 'application/pdf' }],
      blobs: { p: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    });
    await runExtraction('job', { store, scanReader: reader });
    expect(state.finish).toEqual({ status: 'error', error: 'scan_timeout' });
    expect(state.inserted).toHaveLength(0);
    expect(state.deleted).toBe(0);
  });

  it('refuses a job that is not uploaded or error', async () => {
    const { store, state } = fakeStore({ status: 'reviewing' });
    await expect(runExtraction('job', { store })).rejects.toThrow('job_not_extractable');
    expect(state.claimed).toBe(false);
  });
});
