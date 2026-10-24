import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ExtractorModule from '../../app/onboarding/extractor';
import type { DocumentExtractor, ExtractionResult } from '../../app/onboarding/extractor';

/**
 * ADR-0212 (TK-18): a document photo turned the right way up. Real images
 * through real sharp; the reader, Storage and the database are fakes.
 */

const state: { extractor: DocumentExtractor | null } = { extractor: null };

vi.mock('../../app/onboarding/extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof ExtractorModule>();
  return { ...actual, documentExtractor: () => state.extractor };
});

const { bakeOrientation, turnClockwise, turnable, uprightPath } = await import('../upright');
const { extractDocument } = await import('../extract');

/** A 40×20 landscape JPEG — what a passport photo page looks like the right way up. */
async function landscape(orientation?: number): Promise<ArrayBuffer> {
  let image = sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } });
  if (orientation) image = image.withMetadata({ orientation });
  const buffer = await image.jpeg().toBuffer();
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

async function size(bytes: ArrayBuffer) {
  const { width, height, orientation } = await sharp(Buffer.from(bytes)).metadata();
  return { width, height, orientation };
}

function read(uprightTurn: ExtractionResult['uprightTurn'], confidence = 0.95): ExtractionResult {
  return {
    expiryDate: '2033-05-18',
    holidays: null,
    completionDate: null,
    awardingInstitution: null,
    uprightTurn,
    confidence,
    raw: { model: 'claude-test', uprightTurn },
  };
}

const PATH =
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg';

async function fakeAdmin(photo: ArrayBuffer, turnError: unknown = null) {
  const rpc = vi.fn(async (fn: string) => ({
    data: { ok: true },
    error: fn === 'turn_document_upright' ? turnError : null,
  }));
  const download = vi.fn(async () => ({
    data: new Blob([photo], { type: 'image/jpeg' }),
    error: null,
  }));
  const upload = vi.fn(async () => ({ data: {}, error: null }));
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const admin = {
    rpc,
    storage: { from: () => ({ download, upload, remove }) },
  } as unknown as SupabaseClient;
  return { admin, rpc, upload, remove };
}

beforeEach(() => {
  state.extractor = null;
});

describe('the helpers', () => {
  it('turns photos only, never a PDF, the gov.uk report or the Home Office result', () => {
    expect(turnable('passport', 'image/jpeg')).toBe(true);
    expect(turnable('national_id', 'image/png')).toBe(true);
    expect(turnable('passport', 'application/pdf')).toBe(false);
    expect(turnable('passport', 'image/heic')).toBe(false);
    expect(turnable('share_code_report', 'image/jpeg')).toBe(false);
    expect(turnable('home_office_check_result', 'image/png')).toBe(false);
  });

  it('applies the camera orientation tag to the pixels, and leaves an untagged photo alone', async () => {
    const plain = await landscape();
    expect(await bakeOrientation(plain)).toBe(plain);
    const tagged = await landscape(6); // "turn 90° clockwise to view"
    const baked = await size(await bakeOrientation(tagged));
    expect(baked).toMatchObject({ width: 20, height: 40 });
    expect(baked.orientation ?? 1).toBe(1);
  });

  it('turns clockwise by a quarter or a half', async () => {
    expect(await size(await turnClockwise(await landscape(), 90))).toMatchObject({
      width: 20,
      height: 40,
    });
    expect(await size(await turnClockwise(await landscape(), 180))).toMatchObject({
      width: 40,
      height: 20,
    });
  });

  it('puts the copy beside the original, as a new .jpg', () => {
    expect(uprightPath(PATH)).toMatch(
      /^93900000-0000-4000-8000-000000000001\/passport\/[0-9a-f-]{36}\.jpg$/,
    );
    expect(uprightPath(PATH)).not.toBe(PATH);
  });
});

describe('extractDocument turns a sideways photo the right way up', () => {
  it('turns, re-reads, stores the copy and records the upright read', async () => {
    const reads = [read(90, 0.7), read(0, 0.96)];
    const extract = vi.fn(async () => reads.shift()!);
    state.extractor = { provider: 'anthropic', extract };
    const { admin, rpc, upload, remove } = await fakeAdmin(await landscape());

    await extractDocument(admin, 'doc-1', 'passport', PATH, 'image/jpeg');

    expect(extract).toHaveBeenCalledTimes(2);
    const second = (
      extract.mock.calls[1] as unknown as [{ bytes: ArrayBuffer; mimeType: string }]
    )[0];
    expect(second.mimeType).toBe('image/jpeg');
    expect(await size(second.bytes)).toMatchObject({ width: 20, height: 40 });

    expect(upload).toHaveBeenCalledTimes(1);
    const [to] = upload.mock.calls[0] as unknown as [string];
    expect(rpc).toHaveBeenCalledWith('turn_document_upright', {
      p_doc: 'doc-1',
      p_from: PATH,
      p_to: to,
      p_size: second.bytes.byteLength,
      p_turned: 90,
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_document_extraction',
      expect.objectContaining({
        p_confidence: 0.96,
        p_raw: expect.objectContaining({ turnedUpright: 90 }),
      }),
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the original and the first read when the turned copy is not confirmed upright', async () => {
    const reads = [read(90, 0.7), read(90, 0.7)];
    state.extractor = { provider: 'anthropic', extract: async () => reads.shift()! };
    const { admin, rpc, upload } = await fakeAdmin(await landscape());

    await extractDocument(admin, 'doc-1', 'passport', PATH, 'image/jpeg');

    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('turn_document_upright', expect.anything());
    expect(rpc).toHaveBeenCalledWith(
      'record_document_extraction',
      expect.objectContaining({ p_confidence: 0.7 }),
    );
  });

  it('removes the copy again when the database refuses the swap (the office decided meanwhile)', async () => {
    const reads = [read(180), read(0)];
    state.extractor = { provider: 'anthropic', extract: async () => reads.shift()! };
    const { admin, upload, remove, rpc } = await fakeAdmin(await landscape(), { code: 'P0001' });

    await extractDocument(admin, 'doc-1', 'passport', PATH, 'image/jpeg');

    expect(upload).toHaveBeenCalledTimes(1);
    const [to] = upload.mock.calls[0] as unknown as [string];
    expect(remove).toHaveBeenCalledWith([to]);
    expect(rpc).toHaveBeenCalledWith(
      'record_document_extraction',
      expect.objectContaining({ p_raw: expect.not.objectContaining({ turnedUpright: 180 }) }),
    );
  });

  it('reads an upright photo once and touches nothing else', async () => {
    const extract = vi.fn(async () => read(0));
    state.extractor = { provider: 'anthropic', extract };
    const { admin, upload } = await fakeAdmin(await landscape());

    await extractDocument(admin, 'doc-1', 'passport', PATH, 'image/jpeg');

    expect(extract).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('never turns a PDF', async () => {
    const extract = vi.fn(async () => read(90));
    state.extractor = { provider: 'anthropic', extract };
    const { admin, upload } = await fakeAdmin(await landscape());

    await extractDocument(
      admin,
      'doc-1',
      'passport',
      PATH.replace('.jpg', '.pdf'),
      'application/pdf',
    );

    expect(extract).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
  });
});
