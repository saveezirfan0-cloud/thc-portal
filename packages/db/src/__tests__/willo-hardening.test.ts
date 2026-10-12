import { describe, expect, it } from 'vitest';
import { MIN_WEBHOOK_SECRET_LENGTH, readBodyCapped, verifyWilloSignature } from '../willo';
import type { WilloSignatureConfig } from '../willo';

/**
 * Two guards on the Willo webhook (supabase/functions/willo-webhook):
 * a guessable WILLO_WEBHOOK_SECRET is treated as none, and the body is read
 * no further than the cap even when no Content-Length is declared.
 */
const config = (secret: string | null): WilloSignatureConfig => ({
  secret,
  signatureHeader: 'x-willo-signature',
  timestampHeader: null,
  toleranceSeconds: 300,
});
const noHeaders = { get: () => null };

describe('WILLO_WEBHOOK_SECRET shorter than 32 characters', () => {
  it('refuses even the matching token, as if no secret were set', async () => {
    const short = 'a'.repeat(MIN_WEBHOOK_SECRET_LENGTH - 1);
    await expect(verifyWilloSignature('{}', noHeaders, config(short), 0, short)).resolves.toEqual({
      ok: false,
      reason: 'secret_missing',
    });
  });

  it('accepts the matching token at 32 characters', async () => {
    const ok = 'b'.repeat(MIN_WEBHOOK_SECRET_LENGTH);
    await expect(verifyWilloSignature('{}', noHeaders, config(ok), 0, ok)).resolves.toEqual({
      ok: true,
    });
  });
});

/** A body sent as a stream, so the Request has no Content-Length. */
function streamed(chunks: string[]): Request {
  const encoder = new TextEncoder();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[pulled];
      pulled += 1;
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
  });
  return new Request('https://fn.example/willo-webhook', {
    method: 'POST',
    body,
    // Node's fetch needs this for a stream body.
    duplex: 'half',
  } as RequestInit);
}

describe('readBodyCapped', () => {
  it('returns the text when it fits', async () => {
    expect(await readBodyCapped(streamed(['{"a":', '1}']), 64)).toBe('{"a":1}');
  });

  it('stops at the cap when no Content-Length was declared', async () => {
    const request = streamed(['x'.repeat(40), 'y'.repeat(40), 'z'.repeat(1_000_000)]);
    expect(request.headers.get('content-length')).toBeNull();
    expect(await readBodyCapped(request, 64)).toBeNull();
  });

  it('refuses a declared length over the cap without reading', async () => {
    const request = new Request('https://fn.example/willo-webhook', {
      method: 'POST',
      body: 'x'.repeat(100),
    });
    expect(await readBodyCapped(request, 64)).toBeNull();
  });

  it('counts bytes, not characters', async () => {
    expect(await readBodyCapped(streamed(['é'.repeat(40)]), 64)).toBeNull();
    expect(await readBodyCapped(streamed(['é'.repeat(32)]), 64)).toBe('é'.repeat(32));
  });
});
