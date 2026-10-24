import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock('../../../../documents/_lib/generate', () => ({
  contentDisposition: (name: string) => `attachment; filename="${name}"`,
  documentsDb: async () => ({ rpc }),
  isUuid: (v: string) => /^[0-9a-f-]{36}$/.test(v),
  supabaseConfigured: () => true,
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    storage: { from: () => ({ download }) },
  }),
}));

const { GET } = await import('../route');
const ID = '0b5c3e0e-1c0a-4d6e-9a43-3f1d2b7c9a01';
const get = () =>
  GET(new Request(`https://office.test/api/invoices/${ID}/excel`), {
    params: Promise.resolve({ invoiceId: ID }),
  });

beforeEach(() => {
  rpc.mockReset();
  download.mockReset();
  maybeSingle.mockReset();
});

describe('GET /api/invoices/:invoiceId/excel', () => {
  it('serves the stored workbook once the finance gate passes', async () => {
    rpc.mockResolvedValue({
      data: [{ storage_path: 'x.pdf', file_name: 'x.pdf', number: 4001 }],
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: {
        attachments: { excel: { path: 'invoices/4001/x.xlsx', name: 'x.xlsx' }, sources: [] },
      },
      error: null,
    });
    download.mockResolvedValue({ data: new Blob(['PK']), error: null });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('spreadsheetml');
    expect(r.headers.get('Content-Disposition')).toContain('x.xlsx');
    expect(download).toHaveBeenCalledWith('invoices/4001/x.xlsx');
  });

  it('refuses a caller without finance before reading anything', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_permitted' } });
    expect((await get()).status).toBe(403);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('404s an invoice with no workbook (an event invoice)', async () => {
    rpc.mockResolvedValue({
      data: [{ storage_path: 'x.pdf', file_name: 'x.pdf', number: 4000 }],
      error: null,
    });
    maybeSingle.mockResolvedValue({ data: { attachments: [{ path: 'a' }] }, error: null });
    expect((await get()).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });
});
