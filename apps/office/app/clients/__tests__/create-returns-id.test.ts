import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Shift Builder adds a client without leaving the form (§3.2), and has
 * to select it afterwards — so a create hands back the id the RPC returned.
 * An edit returns void and so no id.
 */
const state = vi.hoisted(() => ({
  result: { data: 'client-new' as unknown, error: null as { message: string } | null },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc: async () => state.result }) }));

const { createClientRecord, updateClientRecord } = await import('../actions');

const DRAFT = {
  name: 'Claridge’s',
  contact_name: 'Ana Silva',
  phone: '+44 20 7629 8860',
  staff_contact_point: 'Banqueting office',
  contact_emails: ['events@claridges.example'],
  pays_breaks: false,
  pays_buffer: true,
};

beforeEach(() => {
  state.result = { data: 'client-new', error: null };
});

describe('client writes return the new id', () => {
  it('a create carries the id the RPC returned', async () => {
    expect(await createClientRecord(DRAFT)).toEqual({ ok: true, id: 'client-new' });
  });

  it('an edit has none (update_client returns void)', async () => {
    state.result = { data: null, error: null };
    expect(await updateClientRecord('client-1', DRAFT)).toEqual({ ok: true });
  });

  it('a database refusal is passed on, with no id', async () => {
    state.result = { data: null, error: { message: 'permission denied' } };
    expect(await createClientRecord(DRAFT)).toEqual({ ok: false, message: 'permission denied' });
  });
});
