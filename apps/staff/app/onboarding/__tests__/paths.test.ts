import { describe, expect, it } from 'vitest';
import { documentPath, isOwnDocumentPath } from '../paths';

const me = 'c3910000-0000-4000-8000-000000000001';
const them = 'c3910000-0000-4000-8000-000000000002';
const id = '0b0b0b0b-1111-4222-8333-444444444444';

describe('upload paths in the documents bucket', () => {
  it('builds <staff>/<type>/<uuid>.<ext>', () => {
    expect(documentPath(me, 'passport', id, 'jpg')).toBe(`${me}/passport/${id}.jpg`);
  });

  it('accepts only the caller’s own folder, for the type being uploaded', () => {
    expect(isOwnDocumentPath(me, 'passport', `${me}/passport/${id}.jpg`)).toBe(true);
    expect(isOwnDocumentPath(me, 'passport', `${them}/passport/${id}.jpg`)).toBe(false);
    expect(isOwnDocumentPath(me, 'passport', `${me}/visa_document/${id}.jpg`)).toBe(false);
  });

  it('refuses anything a forged request could slip past a prefix check', () => {
    expect(
      isOwnDocumentPath(me, 'passport', `${me}/passport/../../${them}/passport/${id}.jpg`),
    ).toBe(false);
    expect(isOwnDocumentPath(me, 'passport', `${me}/passport/${id}.exe`)).toBe(false);
    expect(isOwnDocumentPath(me, 'passport', `${me}/passport/anything.jpg`)).toBe(false);
    expect(isOwnDocumentPath('not-a-uuid', 'passport', `not-a-uuid/passport/${id}.jpg`)).toBe(
      false,
    );
  });
});
