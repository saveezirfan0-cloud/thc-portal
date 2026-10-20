import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/invoices/:invoiceId (ADR-0176): the stored PDF, finance only. */
const rpc = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock('../../../documents/_lib/generate', () => ({
  contentDisposition: (name: string) => `attachment; filename="${name}"`,
  documentsDb: async () => ({ rpc }),
  isUuid: (v: string) => /^[0-9a-f-]{36}$/.test(v),
  supabaseConfigured: () => true,
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download }) } }),
}));

const { GET } = await import('../route');

const ID = '0b5c3e0e-1c0a-4d6e-9a43-3f1d2b7c9a01';
const get = (id = ID) =>
  GET(new Request(`https://office.test/api/invoices/${id}`), {
    params: Promise.resolve({ invoiceId: id }),
  });

beforeEach(() => {
  rpc.mockReset();
  download.mockReset();
});

describe('GET /api/invoices/:invoiceId', () => {
  it('serves the stored file under its own name', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          storage_path: 'invoices/4000/x/invoice.pdf',
          file_name: 'Invoice 4000.pdf',
          number: 4000,
        },
      ],
      error: null,
    });
    download.mockResolvedValue({ data: new Blob(['%PDF-1.4']), error: null });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain('Invoice 4000.pdf');
    expect(download).toHaveBeenCalledWith('invoices/4000/x/invoice.pdf');
  });

  it('refuses a caller without finance before touching Storage', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_permitted' } });
    expect((await get()).status).toBe(403);
    expect(download).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown invoice and 409 while it is being drawn', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await get()).status).toBe(404);
    rpc.mockResolvedValue({
      data: [{ storage_path: null, file_name: null, number: 4001 }],
      error: null,
    });
    expect((await get()).status).toBe(409);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a UUID', async () => {
    expect((await get('nope')).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
