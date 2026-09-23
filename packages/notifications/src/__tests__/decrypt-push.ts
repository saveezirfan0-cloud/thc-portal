import { createDecipheriv, createECDH, createHmac } from 'node:crypto';
import { expect } from 'vitest';

/**
 * The receiving side, written independently with node:crypto — the browser's
 * half of RFC 8291 — so a mistake in webpush.ts cannot also be a mistake in
 * the check.
 */
export function decrypt(
  body: Uint8Array,
  uaPrivate: Buffer,
  uaPublic: Buffer,
  auth: Buffer,
): string {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16);
  const rs = b.readUInt32BE(16);
  const idlen = b[20]!;
  const asPublic = b.subarray(21, 21 + idlen);
  const ciphertext = b.subarray(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const hm = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
  const prkKey = hm(auth, secret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
    Buffer.from([1]),
  ]);
  const ikm = hm(prkKey, keyInfo);
  const prk = hm(salt, ikm);
  const cek = hm(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hm(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // Last record: strip trailing zero padding, then the 0x02 delimiter.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  expect(padded[end]).toBe(2);
  return padded.subarray(0, end).toString('utf8');
}
