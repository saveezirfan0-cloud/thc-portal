import { describe, expect, it } from 'vitest';
import {
  FILE_MAX_BYTES,
  baseMime,
  extensionFor,
  fileProblem,
  isAcceptedType,
  kindFor,
  objectPath,
  sizeLabel,
} from '../ticket-files';

describe('files on a ticket (ADR-0204)', () => {
  it('reads the type a recorder reports without its codecs', () => {
    expect(baseMime('video/webm;codecs=vp9')).toBe('video/webm');
    expect(baseMime(' IMAGE/PNG ')).toBe('image/png');
    expect(baseMime('')).toBe('');
  });

  it('takes pictures and videos only, as the bucket does', () => {
    for (const ok of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isAcceptedType(ok)).toBe(true);
    }
    for (const ok of ['video/mp4', 'video/webm', 'video/quicktime', 'video/webm;codecs=vp8']) {
      expect(isAcceptedType(ok)).toBe(true);
    }
    for (const no of ['application/pdf', 'image/svg+xml', 'text/html', 'image/heic', '']) {
      expect(isAcceptedType(no)).toBe(false);
    }
  });

  it('stores each type under its own extension', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('video/quicktime')).toBe('mov');
    expect(extensionFor('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionFor('application/pdf')).toBeNull();
  });

  it('calls a picture a screenshot and a video a recording only when it was recorded here', () => {
    expect(kindFor('image/png')).toBe('screenshot');
    expect(kindFor('image/png', true)).toBe('screenshot');
    expect(kindFor('video/mp4')).toBe('video');
    expect(kindFor('video/webm', true)).toBe('recording');
    expect(kindFor('application/pdf')).toBeNull();
  });

  it('refuses a file the bucket would refuse, before it is sent', () => {
    expect(fileProblem({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull();
    expect(fileProblem({ name: 'a.png', type: 'image/png', size: FILE_MAX_BYTES })).toBeNull();
    expect(fileProblem({ name: 'big.mp4', type: 'video/mp4', size: FILE_MAX_BYTES + 1 })).toMatch(
      /over 50 MB/,
    );
    expect(fileProblem({ name: 'x.pdf', type: 'application/pdf', size: 10 })).toMatch(
      /not a picture or a video/,
    );
    expect(fileProblem({ name: 'empty.png', type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: '', type: 'application/zip', size: 10 })).toMatch(/^That file/);
  });

  it('builds the object path under the ticket, the shape attach_ticket_file checks', () => {
    const ticket = '11111111-2222-4333-8444-555555555555';
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const path = objectPath(ticket, uuid, 'video/webm;codecs=vp9');
    expect(path).toBe(`${ticket}/${uuid}.webm`);
    expect(path).toMatch(new RegExp(`^${ticket}/[0-9a-f-]{36}\\.(png|jpg|webp|gif|mp4|webm|mov)$`));
    expect(objectPath(ticket, uuid, 'application/pdf')).toBeNull();
  });

  it('writes a size a person can read', () => {
    expect(sizeLabel(200)).toBe('1 KB');
    expect(sizeLabel(120_000)).toBe('117 KB');
    expect(sizeLabel(9_000_000)).toBe('8.6 MB');
  });
});
