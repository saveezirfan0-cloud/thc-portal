import { beforeEach, describe, expect, it, vi } from 'vitest';
import { officeCopyLine } from '../../../../../events/[id]/_components/DocumentActions';

/**
 * ADR-0179: the manual Send ("Send Allocation Timesheet" / "Send Completed
 * Timesheet") queues through queue_event_document_email(), which puts the
 * office's hidden copy on the outbox row as payload.bcc and names it in its
 * answer. The route passes it back to the office as `officeCopy` — never in
 * `recipients`, which is the client's own list.
 */
const rpc = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    data: {
      key: 'D1:document:doc-1',
      recipients: ['events@client.test', 'ops@client.test'],
      bcc: ['sam@thehospitalitycompany.co.uk'],
    } as Record<string, unknown>,
    error: null as null | { message: string },
  })),
);
const generateDocument = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    ok: true as const,
    layout: { fileName: 'Allocation.pdf', rowCount: 3 },
    pages: 1,
    documentId: 'doc-1',
    badges: null,
  })),
);
vi.mock('../../../_lib/generate', () => ({
  documentsDb: async () => ({ rpc }),
  generateDocument,
  isUuid: () => true,
  parseKind: (k: unknown) => (k === 'allocation' || k === 'signout' ? k : null),
  refusal: (message: string) => ({ status: 409, message }),
  supabaseConfigured: () => true,
}));

const { POST } = await import('../route');

const EVENT = '0b5c3e0e-1c0a-4d6e-9a43-3f1d2b7c9a01';
const send = (kind: string) =>
  POST(
    new Request(`https://office.test/api/documents/${EVENT}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ kind }),
    }),
    { params: Promise.resolve({ eventId: EVENT }) },
  );

beforeEach(() => {
  rpc.mockClear();
  generateDocument.mockClear();
});

describe('POST /api/documents/:eventId/send and the office copy', () => {
  it.each(['allocation', 'signout'])(
    '%s: queues through the function that adds the bcc',
    async (kind) => {
      const response = await send(kind);
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('queue_event_document_email', { p_document: 'doc-1' });
      const body = (await response.json()) as { recipients: string[]; officeCopy: string[] };
      expect(body.recipients).toEqual(['events@client.test', 'ops@client.test']);
      expect(body.officeCopy).toEqual(['sam@thehospitalitycompany.co.uk']);
      expect(body.recipients).not.toContain('sam@thehospitalitycompany.co.uk');
    },
  );

  it('answers an empty office copy when the function names none', async () => {
    rpc.mockResolvedValueOnce({
      data: { key: 'D1:document:doc-1', recipients: ['events@client.test'] },
      error: null,
    });
    const body = (await (await send('allocation')).json()) as { officeCopy: string[] };
    expect(body.officeCopy).toEqual([]);
  });
});

describe('the Send confirmation', () => {
  it('says who got the hidden copy, and nothing when nobody did', () => {
    expect(officeCopyLine(['sam@thehospitalitycompany.co.uk'])).toBe(
      ' A hidden office copy goes to sam@thehospitalitycompany.co.uk.',
    );
    expect(officeCopyLine([])).toBe('');
    expect(officeCopyLine(undefined)).toBe('');
  });
});
