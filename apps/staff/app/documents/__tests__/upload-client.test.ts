import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The browser half of a Documents upload (`uploadEvidence`): the file is
 * checked on the phone first, the server issues the signed URL for a name
 * it chose, and the file goes up in one PUT (go-live audit L1). The path
 * handed back is the server's, never one the browser made up.
 */
const startUpload = vi.hoisted(() => vi.fn());
const putSignedUpload = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../actions', () => ({ startUpload }));
vi.mock('../../_lib/signed-upload', () => ({ putSignedUpload }));

const { uploadEvidence } = await import('../_components/upload');

const pdf = () => new File(['%PDF-1.7'], 'passport.pdf', { type: 'application/pdf' });

beforeEach(() => {
  startUpload.mockReset();
  putSignedUpload.mockClear();
  putSignedUpload.mockResolvedValue(true);
});

describe('uploadEvidence', () => {
  it('PUTs the file to the URL the server signed, with its own type', async () => {
    startUpload.mockResolvedValue({ ok: true, path: 's1/passport/u.pdf', url: 'https://x/sign' });
    const file = pdf();
    const result = await uploadEvidence({ kind: 'document', docType: 'passport' }, file);
    expect(startUpload).toHaveBeenCalledWith(
      { kind: 'document', docType: 'passport' },
      { name: 'passport.pdf', type: 'application/pdf', size: file.size },
    );
    expect(putSignedUpload).toHaveBeenCalledWith('https://x/sign', file, 'application/pdf');
    expect(result).toEqual({ ok: true, path: 's1/passport/u.pdf' });
  });

  it('refuses a file the rules refuse before asking the server for anything', async () => {
    const gif = new File(['GIF89a'], 'scan.gif', { type: 'image/gif' });
    const result = await uploadEvidence({ kind: 'completion-letter' }, gif);
    expect(result).toEqual({ ok: false, message: 'Upload a PDF, JPG or PNG.' });
    expect(startUpload).not.toHaveBeenCalled();
    expect(putSignedUpload).not.toHaveBeenCalled();
  });

  it('passes on the server’s refusal and sends nothing', async () => {
    startUpload.mockResolvedValue({ ok: false, message: 'Not now.' });
    expect(await uploadEvidence({ kind: 'wtr-optout' }, pdf())).toEqual({
      ok: false,
      message: 'Not now.',
    });
    expect(putSignedUpload).not.toHaveBeenCalled();
  });

  it('says try again when the PUT does not land', async () => {
    startUpload.mockResolvedValue({ ok: true, path: 'p', url: 'https://x/sign' });
    putSignedUpload.mockResolvedValue(false);
    expect(await uploadEvidence({ kind: 'completion-letter' }, pdf())).toEqual({
      ok: false,
      message: 'The upload did not complete. Please try again.',
    });
  });
});
