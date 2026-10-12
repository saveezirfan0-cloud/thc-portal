import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/documents/:eventId stores and records an issued copy, so a
 * request another site started is refused before any work (security
 * review, item 2). Allowed: Sec-Fetch-Site `same-origin`, `none`, or no
 * header at all (an old browser; see _lib/fetchSite.ts).
 */
const generateDocument = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    pdf: Buffer.from('%PDF-1.4'),
    layout: { fileName: 'Allocation.pdf' },
    pages: 1,
    documentId: 'doc-1',
    storagePath: 'p',
    badges: null,
  })),
);
vi.mock('../../_lib/generate', () => ({
  contentDisposition: (name: string) => `attachment; filename="${name}"`,
  generateDocument,
  isUuid: () => true,
  parseKind: (k: string) => (k === 'allocation' || k === 'signout' ? k : null),
  supabaseConfigured: () => true,
}));

const { GET } = await import('../route');

const EVENT = '0b5c3e0e-1c0a-4d6e-9a43-3f1d2b7c9a01';
const get = (site?: string) =>
  GET(
    new Request(`https://office.test/api/documents/${EVENT}?kind=allocation`, {
      headers: site ? { 'sec-fetch-site': site } : {},
    }),
    { params: Promise.resolve({ eventId: EVENT }) },
  );

beforeEach(() => generateDocument.mockClear());

describe('GET /api/documents/:eventId and Sec-Fetch-Site', () => {
  it.each(['cross-site', 'same-site'])(
    'refuses %s with 403 before drawing anything',
    async (site) => {
      const response = await get(site);
      expect(response.status).toBe(403);
      expect(generateDocument).not.toHaveBeenCalled();
    },
  );

  it.each(['same-origin', 'none'])('serves %s', async (site) => {
    const response = await get(site);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(generateDocument).toHaveBeenCalledTimes(1);
  });

  it('serves a browser that sends no Sec-Fetch-Site at all', async () => {
    expect((await get()).status).toBe(200);
    expect(generateDocument).toHaveBeenCalledTimes(1);
  });
});
