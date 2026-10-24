/* eslint-disable @typescript-eslint/no-explicit-any -- fakes */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, shiftRow } from './fakeDb';
import type { Call } from './fakeDb';

const state = vi.hoisted(() => ({
  db: null as any,
  storage: null as any,
  role: 'manager' as string | null,
  configured: true,
  afterFns: [] as (() => unknown)[],
  extraction: vi.fn(),
  draw: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    state.afterFns.push(fn);
  },
}));
vi.mock('../../../_components/officeUser', () => ({ currentOfficeRole: async () => state.role }));
vi.mock('../_lib/db', () => ({
  BUCKET: 'timesheets',
  supabaseConfigured: () => state.configured,
  officeDb: async () => state.db,
  storageAdmin: () => state.storage,
}));
vi.mock('../_lib/bridges', () => ({
  runExtraction: (id: string) => state.extraction(id),
  drawInvoice: (id: string) => state.draw(id),
}));

import {
  abandonUpload,
  approveAllClean,
  backToReview,
  changeClient,
  checkPoDuplicates,
  confirmJob,
  discardJob,
  finishUpload,
  generateInvoices,
  redrawInvoice,
  retryExtraction,
  setShiftStatus,
  startUpload,
  updateShift,
} from '../actions';

const JOB = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const clientRow = (over: Record<string, unknown> = {}) => ({
  id: CLIENT,
  name: 'Leonardo St Paul’s M&E',
  invoice_format: 'aggregated',
  po_required: true,
  timesheet_default_role: 'Waiting',
  invoicing_mode: 'timesheet',
  ...over,
});
const writes = (calls: Call[], table: string, op: Call['op']) =>
  calls.filter((c) => c.table === table && c.op === op);

beforeEach(() => {
  state.role = 'manager';
  state.configured = true;
  state.afterFns = [];
  state.extraction.mockReset().mockResolvedValue(undefined);
  state.draw.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('who may act', () => {
  it('a viewer sees but cannot write', async () => {
    state.role = 'viewer';
    state.db = fakeDb(() => ({ data: [] })).db;
    expect(await updateShift(JOB, 's1', { staffName: 'X' })).toEqual({
      error: 'Your login is read-only, so this cannot be changed.',
    });
    expect(await generateInvoices(JOB)).toMatchObject({
      error: expect.stringContaining('read-only'),
    });
  });

  it('a scheduler has no finance access', async () => {
    state.role = 'scheduler';
    expect(await discardJob(JOB)).toMatchObject({
      error: expect.stringContaining('owners and managers'),
    });
  });

  it('says so when there is no project', async () => {
    state.configured = false;
    expect(await retryExtraction(JOB)).toEqual({
      error: 'This environment has no Supabase project.',
    });
  });
});

describe('startUpload / finishUpload', () => {
  function storage(over: Record<string, any> = {}) {
    const bucket = {
      createSignedUploadUrl: vi.fn(async (path: string) => ({
        data: { token: `tok:${path}`, path },
        error: null,
      })),
      list: vi.fn(async () => ({ data: [], error: null })),
      remove: vi.fn(async () => ({ error: null })),
      ...over,
    };
    return { bucket, client: { storage: { from: () => bucket } } };
  }

  it('refuses a bad file before anything is signed', async () => {
    const s = storage();
    state.storage = s.client;
    state.db = fakeDb(() => ({ data: [clientRow()] })).db;
    const result = await startUpload({
      clientId: CLIENT,
      files: [{ name: 'notes.docx', size: 10 }],
    });
    expect(result).toMatchObject({
      error: expect.stringContaining('only Excel, CSV, PDF, JPG and PNG'),
    });
    expect(s.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(
      await startUpload({ clientId: CLIENT, files: [{ name: 'a.pdf', size: 26 * 1024 * 1024 }] }),
    ).toMatchObject({
      error: expect.stringContaining('25 MB'),
    });
    expect(await startUpload({ clientId: '', files: [{ name: 'a.pdf', size: 10 }] })).toEqual({
      error: 'Choose a client.',
    });
  });

  it('refuses a client that is not invoiced from timesheets', async () => {
    state.storage = storage().client;
    state.db = fakeDb(() => ({ data: [clientRow({ invoicing_mode: 'events' })] })).db;
    expect(
      await startUpload({ clientId: CLIENT, files: [{ name: 'a.pdf', size: 10 }] }),
    ).toMatchObject({
      error: expect.stringContaining('not set up for timesheet invoicing'),
    });
  });

  it('signs one upload per file under timesheet-jobs/<job>/<file>-<name>', async () => {
    const s = storage();
    state.storage = s.client;
    state.db = fakeDb(() => ({ data: [clientRow()] })).db;
    const plan = await startUpload({
      clientId: CLIENT,
      files: [
        { name: 'Week 42.xlsx', size: 100 },
        { name: 'scan.pdf', size: 200 },
      ],
    });
    if (!('jobId' in plan)) throw new Error('expected a plan');
    expect(plan.uploads).toHaveLength(2);
    expect(plan.uploads[0]!.path).toBe(
      `timesheet-jobs/${plan.jobId}/${plan.uploads[0]!.fileId}-Week-42.xlsx`,
    );
    expect(plan.uploads[1]!.token).toBe(`tok:${plan.uploads[1]!.path}`);
  });

  it('creates the job and its files, reads after the response, and goes to the job', async () => {
    const fileId = '33333333-3333-4333-8333-333333333333';
    const name = `${fileId}-Week-42.xlsx`;
    const s = storage({
      list: vi.fn(async () => ({ data: [{ name, metadata: { size: 4096 } }], error: null })),
    });
    state.storage = s.client;
    const f = fakeDb((c) => {
      if (c.table === 'clients') return { data: [clientRow()] };
      if (c.table === 'timesheet_jobs' && c.op === 'insert') return { data: [{ id: JOB }] };
      return { data: [] };
    });
    state.db = f.db;

    await expect(
      finishUpload({
        jobId: JOB,
        clientId: CLIENT,
        notes: ' week 42 ',
        files: [{ fileId, name: 'Week 42.xlsx', size: 4096 }],
      }),
    ).rejects.toThrow(`REDIRECT:/invoices/process/${JOB}`);

    const [job] = writes(f.calls, 'timesheet_jobs', 'insert');
    expect(job!.values).toEqual({ id: JOB, client_id: CLIENT, notes: 'week 42' });
    const [files] = writes(f.calls, 'timesheet_files', 'insert');
    expect(files!.values).toEqual([
      {
        id: fileId,
        job_id: JOB,
        storage_path: `timesheet-jobs/${JOB}/${name}`,
        file_name: 'Week-42.xlsx',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size_bytes: 4096,
      },
    ]);
    expect(state.afterFns).toHaveLength(1);
    await state.afterFns[0]!();
    expect(state.extraction).toHaveBeenCalledWith(JOB);
  });

  it('trusts the bucket, not the browser: a missing or oversize object cleans up and stops', async () => {
    const fileId = '33333333-3333-4333-8333-333333333333';
    const s = storage(); // nothing listed
    state.storage = s.client;
    const f = fakeDb(() => ({ data: [clientRow()] }));
    state.db = f.db;
    const result = await finishUpload({
      jobId: JOB,
      clientId: CLIENT,
      notes: '',
      files: [{ fileId, name: 'a.pdf', size: 10 }],
    });
    expect(result).toEqual({ error: 'a.pdf did not finish uploading. Try again.' });
    expect(s.bucket.remove).toHaveBeenCalled();
    expect(writes(f.calls, 'timesheet_jobs', 'insert')).toHaveLength(0);

    const big = storage({
      list: vi.fn(async () => ({
        data: [{ name: `${fileId}-a.pdf`, metadata: { size: 26 * 1024 * 1024 } }],
        error: null,
      })),
    });
    state.storage = big.client;
    expect(
      await finishUpload({
        jobId: JOB,
        clientId: CLIENT,
        notes: '',
        files: [{ fileId, name: 'a.pdf', size: 10 }],
      }),
    ).toEqual({ error: 'a.pdf is over the 25 MB limit.' });
  });

  it('abandonUpload never touches a real job’s files', async () => {
    const s = storage();
    state.storage = s.client;
    state.db = fakeDb(() => ({ data: [{ id: JOB }] })).db;
    await abandonUpload(JOB, [`timesheet-jobs/${JOB}/x-a.pdf`]);
    expect(s.bucket.remove).not.toHaveBeenCalled();

    state.db = fakeDb(() => ({ data: [] })).db;
    await abandonUpload(JOB, [
      `timesheet-jobs/${JOB}/x-a.pdf`,
      'timesheet-jobs/other/x.pdf',
      `timesheet-jobs/${JOB}/../x`,
    ]);
    expect(s.bucket.remove).toHaveBeenCalledWith([`timesheet-jobs/${JOB}/x-a.pdf`]);
  });
});

describe('retryExtraction', () => {
  it('reads the files again only for a job in error, leaving error → extracting to runExtraction', async () => {
    const f = fakeDb(() => ({ data: [{ id: JOB, status: 'error' }] }));
    state.db = f.db;
    expect(await retryExtraction(JOB)).toEqual({ ok: true });
    await state.afterFns[0]!();
    expect(state.extraction).toHaveBeenCalledWith(JOB);
    expect(writes(f.calls, 'timesheet_jobs', 'update')).toHaveLength(0);

    state.afterFns = [];
    state.db = fakeDb(() => ({ data: [{ id: JOB, status: 'reviewing' }] })).db;
    expect(await retryExtraction(JOB)).toMatchObject({
      error: expect.stringContaining('not in an error state'),
    });
    expect(state.afterFns).toHaveLength(0);
  });
});

describe('updateShift', () => {
  it('writes only the edited columns and returns the database’s own row', async () => {
    const f = fakeDb((c) => {
      if (c.op === 'select') return { data: [shiftRow()] };
      return { data: [shiftRow({ role_name: 'Bar Staff', rate: 18.98, amount: 142.35 })] };
    });
    state.db = f.db;
    const result = await updateShift(JOB, 's1', { roleName: 'Bar Staff' });
    expect(writes(f.calls, 'timesheet_shifts', 'update')[0]!.values).toEqual({
      role_name: 'Bar Staff',
      rate: null,
    });
    expect(result).toMatchObject({
      ok: true,
      row: { roleName: 'Bar Staff', startTime: '10:00', amount: 142.35 },
    });
  });

  it('does not write when the edit is nonsense, and hands back the stored row', async () => {
    const f = fakeDb(() => ({ data: [shiftRow()] }));
    state.db = f.db;
    const result = await updateShift(JOB, 's1', { startTime: '99:99' });
    expect(result).toMatchObject({ error: 'Enter a time such as 17:30.', row: { id: 's1' } });
    expect(writes(f.calls, 'timesheet_shifts', 'update')).toHaveLength(0);
  });

  it('an approved row that an edit leaves incomplete goes back to Extracted, with a notice', async () => {
    let attempt = 0;
    const f = fakeDb((c) => {
      if (c.op === 'select') return { data: [shiftRow({ status: 'approved' })] };
      attempt += 1;
      if (attempt === 1) {
        return { error: { code: 'P0001', message: 'shift_incomplete', details: 'no_rate' } };
      }
      return {
        data: [shiftRow({ status: 'extracted', rate: null, amount: null, issues: ['no_rate'] })],
      };
    });
    state.db = f.db;
    const result = await updateShift(JOB, 's1', { roleName: 'Mystery' });
    const updates = writes(f.calls, 'timesheet_shifts', 'update');
    expect(updates[1]!.values).toEqual({ role_name: 'Mystery', rate: null, status: 'extracted' });
    expect(result).toMatchObject({
      ok: true,
      notice: expect.stringContaining('back to Extracted'),
      row: { status: 'extracted' },
    });
  });

  it('shows the reason when the database refuses, and a row already invoiced is not touched', async () => {
    const f = fakeDb((c) =>
      c.op === 'select'
        ? { data: [shiftRow({ status: 'extracted' })] }
        : { error: { code: 'P0001', message: 'shift_incomplete', details: 'no_hours,no_rate' } },
    );
    state.db = f.db;
    const result = await updateShift(JOB, 's1', { staffName: 'Z' });
    expect(result).toMatchObject({
      error: expect.stringContaining('no hours, no rate for this role'),
    });

    state.db = fakeDb(() => ({ data: [shiftRow({ invoice_id: 'inv-1' })] })).db;
    expect(await updateShift(JOB, 's1', { staffName: 'Z' })).toMatchObject({
      error: 'This row is already on an invoice and cannot change.',
    });
  });
});

describe('setShiftStatus', () => {
  it('surfaces shift_incomplete inline, in words', async () => {
    const f = fakeDb((c) =>
      c.op === 'select'
        ? { data: [shiftRow({ issues: ['no_hours'] })] }
        : { error: { code: 'P0001', message: 'shift_incomplete', details: 'no_hours' } },
    );
    state.db = f.db;
    const result = await setShiftStatus(JOB, 's1', 'approved');
    expect(result).toMatchObject({
      error: 'Cannot approve this row: no hours. Fix the highlighted cells first.',
    });
  });

  it('approves a complete row and returns it', async () => {
    const f = fakeDb((c) => ({
      data: [shiftRow({ status: c.op === 'update' ? 'approved' : 'extracted' })],
    }));
    state.db = f.db;
    expect(await setShiftStatus(JOB, 's1', 'approved')).toMatchObject({
      ok: true,
      row: { status: 'approved' },
    });
  });
});

describe('approveAllClean', () => {
  it('approves only the clean rows', async () => {
    const rows = [
      shiftRow({ id: 'clean' }),
      shiftRow({ id: 'unsure', confidence: 0.4 }),
      shiftRow({ id: 'issue', status: 'flagged', issues: ['no_rate'] }),
      shiftRow({ id: 'done', status: 'approved' }),
      shiftRow({ id: 'exact', confidence: 0.75, status: 'flagged' }),
    ];
    const f = fakeDb((c) => (c.op === 'select' ? { data: rows } : { data: [] }));
    state.db = f.db;
    const result = await approveAllClean(JOB);
    const [update] = writes(f.calls, 'timesheet_shifts', 'update');
    expect(update!.values).toEqual({ status: 'approved' });
    expect(update!.filters.find((x) => x[1] === 'in')![2]).toEqual(['clean', 'exact']);
    expect(result).toMatchObject({ ok: true, approved: 2 });
  });
});

describe('changeClient', () => {
  it('re-prices by clearing rates, and demotes an approved row that cannot be priced', async () => {
    const f = fakeDb((c) => {
      if (c.table === 'timesheet_jobs' && c.op === 'select')
        return { data: [{ id: JOB, status: 'reviewing' }] };
      if (c.table === 'clients') return { data: [clientRow()] };
      if (c.table === 'timesheet_shifts' && c.op === 'select' && c.columns === 'id') {
        return { data: [{ id: 'a1' }] };
      }
      if (
        c.table === 'timesheet_shifts' &&
        c.op === 'update' &&
        c.filters.some((x) => x[0] === 'id') &&
        !('status' in c.values)
      ) {
        return { error: { code: 'P0001', message: 'shift_incomplete', details: 'no_rate' } };
      }
      return { data: [] };
    });
    state.db = f.db;
    const result = await changeClient(JOB, CLIENT);
    expect(result).toMatchObject({
      ok: true,
      demoted: 1,
      client: { id: CLIENT, invoiceFormat: 'aggregated' },
    });
    const updates = writes(f.calls, 'timesheet_shifts', 'update').map((c) => c.values);
    expect(updates).toContainEqual({ rate: null });
    expect(updates).toContainEqual({ rate: null, status: 'extracted' });
    expect(writes(f.calls, 'timesheet_jobs', 'update')[0]!.values).toEqual({ client_id: CLIENT });
  });

  it('only in review, and only to a timesheet client', async () => {
    state.db = fakeDb(() => ({ data: [{ id: JOB, status: 'confirmed' }] })).db;
    expect(await changeClient(JOB, CLIENT)).toMatchObject({
      error: expect.stringContaining('no longer in review'),
    });
  });
});

describe('discardJob', () => {
  const review = (rows: any[], status = 'reviewing') =>
    fakeDb((c) => {
      if (c.table === 'timesheet_jobs' && c.op === 'select') return { data: [{ id: JOB, status }] };
      if (c.table === 'timesheet_shifts') return { data: rows };
      return { data: [{ id: JOB }] };
    });

  it('refuses while approved rows would be lost', async () => {
    const f = review([
      shiftRow({ status: 'approved' }),
      shiftRow({ id: 's2', status: 'approved' }),
    ]);
    state.db = f.db;
    const r = await discardJob(JOB);
    expect(r).toMatchObject({ error: expect.stringContaining('2 approved rows would be lost') });
    expect(writes(f.calls, 'timesheet_jobs', 'update')).toHaveLength(0);
  });

  it('refuses a row already on an invoice', async () => {
    state.db = review([shiftRow({ invoice_id: 'inv' })]).db;
    expect(await discardJob(JOB)).toMatchObject({
      error: expect.stringContaining('already on an invoice'),
    });
  });

  it('closes a job that has nothing signed off, reviewing → complete', async () => {
    const f = review([shiftRow({ status: 'rejected' }), shiftRow({ id: 's2' })]);
    state.db = f.db;
    expect(await discardJob(JOB)).toEqual({ ok: true });
    const [u] = writes(f.calls, 'timesheet_jobs', 'update');
    expect(u!.values).toEqual({ status: 'complete' });
    expect(u!.filters).toContainEqual(['status', 'eq', 'reviewing']);
  });

  it('only a job waiting for review', async () => {
    state.db = review([], 'confirmed').db;
    expect(await discardJob(JOB)).toMatchObject({
      error: expect.stringContaining('waiting for review'),
    });
  });
});

describe('confirmJob', () => {
  const rows = [
    shiftRow({ id: 'a', status: 'approved' }),
    shiftRow({ id: 'b', status: 'approved' }),
    shiftRow({ id: 'c' }),
  ];
  const good = {
    poNumber: '52257014',
    invoiceDate: '2026-10-26',
    eventDateStart: '2026-10-19',
    eventDateEnd: '2026-10-20',
    format: 'aggregated',
    shiftIds: ['a', 'b'],
  };
  const db = (rpc?: (fn: string, args: any) => any) =>
    fakeDb((c) => {
      if (c.table === 'timesheet_jobs')
        return { data: [{ id: JOB, status: 'reviewing', client_id: CLIENT }] };
      if (c.table === 'clients') return { data: [clientRow()] };
      return { data: rows };
    }, rpc);

  it('stops a missing PO before the database is asked', async () => {
    const f = db();
    state.db = f.db;
    const result = await confirmJob(JOB, [{ ...good, poNumber: '' }]);
    expect(result).toMatchObject({ error: expect.stringContaining('needs a PO number') });
    expect(f.rpcCalls).toHaveLength(0);
  });

  it('stops an approved row left out of every invoice', async () => {
    const f = db();
    state.db = f.db;
    const result = await confirmJob(JOB, [{ ...good, shiftIds: ['a'] }]);
    expect(result).toMatchObject({
      error: expect.stringContaining('1 approved row is not in any invoice'),
    });
    expect(f.rpcCalls).toHaveLength(0);
  });

  it('calls timesheet_job_confirm with the groups, once', async () => {
    const f = db();
    state.db = f.db;
    expect(await confirmJob(JOB, [{ ...good, poNumber: ' 52257014 ' }])).toEqual({ ok: true });
    expect(f.rpcCalls).toEqual([
      { fn: 'timesheet_job_confirm', args: { p_job: JOB, p_groups: [good] } },
    ]);
  });

  it('words the database’s own refusals', async () => {
    state.db = db(() => ({ error: { code: 'P0001', message: 'po_required' } })).db;
    expect(await confirmJob(JOB, [good])).toEqual({
      error: 'This client needs a PO number on every invoice.',
    });
  });
});

describe('checkPoDuplicates', () => {
  it('lists the invoices that already carry the PO', async () => {
    const f = fakeDb(
      () => ({ data: [] }),
      () => ({
        data: [
          {
            po_number: '52257014',
            invoice_number: 4001,
            invoice_date: '2026-10-12',
            status: 'queued',
          },
        ],
      }),
    );
    state.db = f.db;
    expect(await checkPoDuplicates(CLIENT, [' 52257014 ', '52257014', ''])).toEqual({
      ok: true,
      duplicates: [
        { poNumber: '52257014', invoiceNumber: 4001, invoiceDate: '2026-10-12', status: 'queued' },
      ],
    });
    expect(f.rpcCalls[0]!.args).toEqual({ p_client: CLIENT, p_pos: ['52257014'] });
    expect(await checkPoDuplicates(CLIENT, ['', ' '])).toEqual({ ok: true, duplicates: [] });
  });
});

describe('backToReview', () => {
  it('only while nothing has been issued', async () => {
    state.db = fakeDb((c) =>
      c.table === 'invoices' ? { data: [{ id: 'inv' }] } : { data: [] },
    ).db;
    expect(await backToReview(JOB)).toMatchObject({
      error: expect.stringContaining('already been issued'),
    });
    const f = fakeDb((c) => (c.table === 'invoices' ? { data: [] } : { data: [{ id: JOB }] }));
    state.db = f.db;
    expect(await backToReview(JOB)).toEqual({ ok: true });
    expect(writes(f.calls, 'timesheet_jobs', 'update')[0]!.values).toEqual({ status: 'reviewing' });
  });
});

describe('generateInvoices — safe to press twice', () => {
  const g = (ids: string[], po: string) => ({
    poNumber: po,
    invoiceDate: '2026-10-26',
    eventDateStart: '2026-10-19',
    eventDateEnd: '2026-10-20',
    format: 'named',
    shiftIds: ids,
  });
  const groups = [g(['a', 'b'], 'P1'), g(['c'], 'P2'), g(['d'], 'P3')];

  function setup(opts: {
    invoiced?: Record<string, string>;
    status?: string;
    rpc?: (fn: string, args: any) => any;
  }) {
    let n = 4000;
    const f = fakeDb(
      (c) => {
        if (c.table === 'timesheet_jobs') {
          return {
            data: [{ id: JOB, status: opts.status ?? 'confirmed', confirmed_groups: groups }],
          };
        }
        if (c.table === 'timesheet_shifts') {
          return {
            data: Object.entries(opts.invoiced ?? {}).map(([id, invoice_id]) => ({
              id,
              invoice_id,
            })),
          };
        }
        return { data: [] };
      },
      opts.rpc ??
        ((fn) =>
          fn === 'issue_timesheet_invoice' ? { data: { id: `inv-${n}`, number: n++ } } : undefined),
    );
    state.db = f.db;
    return f;
  }

  it('issues each group that has no invoice yet, then draws it', async () => {
    const f = setup({});
    const result = await generateInvoices(JOB);
    expect(result).toEqual({ ok: true, issued: 3, drawFailed: [] });
    expect(f.rpcCalls.map((c) => c.args.p_group.poNumber)).toEqual(['P1', 'P2', 'P3']);
    expect(f.rpcCalls[0]!.args.p_job).toBe(JOB);
    expect(state.draw.mock.calls.map((c) => c[0])).toEqual(['inv-4000', 'inv-4001', 'inv-4002']);
  });

  it('skips groups already issued (a refresh, a second click)', async () => {
    const f = setup({ invoiced: { b: 'inv-3999' } });
    const result = await generateInvoices(JOB);
    expect(result).toMatchObject({ ok: true, issued: 2 });
    expect(f.rpcCalls.map((c) => c.args.p_group.poNumber)).toEqual(['P2', 'P3']);
  });

  it('a second click that loses the race is not an error', async () => {
    const f = setup({
      rpc: (_fn, args) =>
        args.p_group.poNumber === 'P1'
          ? { error: { code: 'P0001', message: 'shift_not_approved' } }
          : { data: { id: `inv-${args.p_group.poNumber}`, number: 4001 } },
    });
    const result = await generateInvoices(JOB);
    expect(result).toMatchObject({ ok: true, issued: 2 });
    expect(f.rpcCalls).toHaveLength(3);
  });

  it('a PDF that fails to draw keeps its number and is reported, not lost', async () => {
    setup({});
    state.draw.mockImplementation(async (id: string) =>
      id === 'inv-4001' ? { ok: false, error: 'chromium crashed' } : { ok: true },
    );
    const result = await generateInvoices(JOB);
    expect(result).toEqual({
      ok: true,
      issued: 3,
      drawFailed: [{ invoiceId: 'inv-4001', number: 4001, error: 'chromium crashed' }],
    });
  });

  it('a thrown draw is also kept as a failure', async () => {
    setup({});
    state.draw.mockRejectedValueOnce(new Error('boom'));
    const result = await generateInvoices(JOB);
    expect(result).toMatchObject({
      ok: true,
      issued: 3,
      drawFailed: [{ number: 4000, error: 'boom' }],
    });
  });

  it('a hard refusal on the first group says why and issues nothing', async () => {
    const f = setup({ rpc: () => ({ error: { code: 'P0001', message: 'po_required' } }) });
    expect(await generateInvoices(JOB)).toEqual({
      error: 'This client needs a PO number on every invoice.',
    });
    expect(f.rpcCalls).toHaveLength(1);
  });

  it('a refusal part-way keeps what was numbered and says so', async () => {
    setup({
      rpc: (_fn, args) =>
        args.p_group.poNumber === 'P2'
          ? { error: { code: 'P0001', message: 'po_required' } }
          : { data: { id: `inv-${args.p_group.poNumber}`, number: 4000 } },
    });
    const result = await generateInvoices(JOB);
    expect(result).toMatchObject({ error: expect.stringContaining('already numbered are kept') });
  });

  it('only a confirmed (or completed) job', async () => {
    setup({ status: 'reviewing' });
    expect(await generateInvoices(JOB)).toMatchObject({
      error: expect.stringContaining('not waiting to be generated'),
    });
  });
});

describe('redrawInvoice', () => {
  const inv = (over: Record<string, unknown>) =>
    fakeDb(() => ({
      data: [
        {
          id: 'i1',
          source: 'timesheet',
          status: 'failed',
          created_at: new Date().toISOString(),
          timesheet_job_id: JOB,
          ...over,
        },
      ],
    }));

  it('draws a failed timesheet invoice again', async () => {
    state.db = inv({}).db;
    expect(await redrawInvoice('i1')).toEqual({ ok: true });
    expect(state.draw).toHaveBeenCalledWith('i1');
  });

  it('passes a draw failure through', async () => {
    state.db = inv({}).db;
    state.draw.mockResolvedValue({ ok: false, error: 'no fonts' });
    expect(await redrawInvoice('i1')).toEqual({ error: 'no fonts' });
  });

  it('leaves a drawing invoice alone until it has stalled, and an event invoice always', async () => {
    state.db = inv({ status: 'drawing' }).db;
    expect(await redrawInvoice('i1')).toMatchObject({
      error: expect.stringContaining('not waiting for a re-draw'),
    });
    state.db = inv({
      status: 'drawing',
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    }).db;
    expect(await redrawInvoice('i1')).toEqual({ ok: true });
    state.db = inv({ source: 'events' }).db;
    expect(await redrawInvoice('i1')).toMatchObject({ error: 'That invoice was not found.' });
  });
});
