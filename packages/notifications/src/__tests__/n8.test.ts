import { createECDH } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DrainConfig, DrainPorts } from '../drain';
import { drainRow } from '../drain';
import type { OutboxRow } from '../outbox';
import { messageFor } from '../outbox';
import { body, render, template } from '../templates';
import { b64urlEncode } from '../webpush';
import { decrypt } from './decrypt-push';

/**
 * N8 "Document rejected — [reason]. Re-upload." (audit D42).
 *
 * The push lands where the Re-upload is: the onboarding wizard for a
 * candidate, whose app is locked to it, and the Documents hub for a worker.
 * It carries a "Re-upload" button where the platform draws one, and it is
 * tagged by the document, so a second rejection of the same document
 * replaces the first on the device and two documents stay two. The copy is
 * the register's, unchanged.
 */

const n8 = (payload: Record<string, string>): OutboxRow => ({
  id: 8,
  key: 'N8:doc:doc-1',
  channel: 'push',
  template: 'N8',
  recipient_staff_id: 'staff-1',
  recipient_emails: null,
  payload,
  attempts: 1,
});

const reason = { reason: 'The photo page is cut off', document: 'Passport', documentId: 'doc-1' };

describe('N8 in the register', () => {
  it('keeps the copy word for word', () => {
    expect(render(body('N8'), { reason: 'Expired' })).toBe('Document rejected — Expired. Re-upload.');
  });

  it('names its button and its two landings', () => {
    expect(template('N8').action).toBe('Re-upload');
    expect(template('N8').deepLink).toBe('/documents');
    expect([...(template('N8').deepLinkOptions ?? [])].sort()).toEqual([
      '/documents',
      '/onboarding',
    ]);
  });
});

describe('N8 as a message', () => {
  it('sends a candidate to the onboarding wizard, where their re-upload is', () => {
    expect(messageFor(n8({ ...reason, link: '/onboarding' }))).toEqual({
      kind: 'push',
      staffId: 'staff-1',
      title: 'Document rejected',
      body: 'Document rejected — The photo page is cut off. Re-upload.',
      url: '/onboarding',
      action: 'Re-upload',
      tag: 'N8:doc-1',
    });
  });

  it('sends a worker to the Documents hub', () => {
    expect(messageFor(n8({ ...reason, link: '/documents' }))).toMatchObject({
      url: '/documents',
      tag: 'N8:doc-1',
    });
  });

  it('never follows a link the register does not list', () => {
    expect(messageFor(n8({ ...reason, link: 'https://evil.example/' }))).toMatchObject({
      url: '/documents',
    });
    expect(messageFor(n8({ ...reason, link: '/shifts' }))).toMatchObject({ url: '/documents' });
  });

  it('lands on the Documents hub for a row queued before the link existed', () => {
    const msg = messageFor(n8({ reason: 'Blurred', document: 'Passport' }));
    expect(msg).toMatchObject({ url: '/documents', action: 'Re-upload' });
    // No document id: no tag, rather than one tag shared by every document.
    expect(msg).not.toHaveProperty('tag');
  });

  it('tags per document, so two documents are two notifications', () => {
    const a = messageFor(n8({ ...reason, documentId: 'doc-a' }));
    const b = messageFor(n8({ ...reason, documentId: 'doc-b' }));
    expect(a).toMatchObject({ tag: 'N8:doc-a' });
    expect(b).toMatchObject({ tag: 'N8:doc-b' });
  });

  it('adds no button or tag to a push the register gives none', () => {
    const msg = messageFor({ ...n8({}), key: 'N12:booking:1', template: 'N12' });
    expect(msg).not.toHaveProperty('action');
    expect(msg).not.toHaveProperty('tag');
  });
});

describe('N8 on the device', () => {
  const vapid = (() => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      publicKey: b64urlEncode(ecdh.getPublicKey()),
      privateKey: b64urlEncode(ecdh.getPrivateKey()),
      subject: 'mailto:admin@thehospitalitycompany.co.uk',
    };
  })();
  const config: DrainConfig = { resendApiKey: null, vapid, missing: [] };

  it('carries the url, the button and the tag the service worker reads', async () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = new Uint8Array(16).fill(8);
    const sent: (string | Uint8Array)[] = [];
    const ports: DrainPorts = {
      http: vi.fn(async (req) => {
        sent.push(req.body);
        return { status: 201, text: async () => '' };
      }),
      subscriptionsFor: vi.fn(async () => [
        {
          endpoint: 'https://fcm.googleapis.com/fcm/send/n8-device',
          p256dh: b64urlEncode(browser.getPublicKey()),
          auth: b64urlEncode(auth),
        },
      ]),
      deleteSubscription: vi.fn(async () => undefined),
      download: vi.fn(async () => null),
      log: vi.fn(),
    };

    const settled = await drainRow(n8({ ...reason, link: '/onboarding' }), config, null, ports);
    expect(settled.verdict).toBe('sent');
    const payload = JSON.parse(
      decrypt(
        sent[0] as Uint8Array,
        browser.getPrivateKey(),
        browser.getPublicKey(),
        Buffer.from(auth),
      ),
    );
    expect(payload).toEqual({
      title: 'Document rejected',
      body: 'Document rejected — The photo page is cut off. Re-upload.',
      url: '/onboarding',
      action: 'Re-upload',
      tag: 'N8:doc-1',
    });
  });
});
