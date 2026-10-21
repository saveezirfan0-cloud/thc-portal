import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from './fixtures';

/**
 * ADR-0180 · Update your declaration, on the app side.
 *
 * The database half — who may answer, the new row, the old one superseded,
 * a compliant worker paused — is 915_declaration_more_details.sql. Here:
 *
 *   1. the read is parsed to what the worker may see (the office's message,
 *      never the details or the review note), and an unknown answer is no;
 *   2. the Documents row offers "Update your declaration" exactly when the
 *      database says the worker may — for a candidate's rejection, a
 *      request for details, and staff whose declaration was rejected;
 *   3. the action calls `update_my_declaration()` with no staff id, the
 *      details trimmed, and words every refusal;
 *   4. the form shows the office's message and, for a compliant worker,
 *      says the update pauses their shifts and asks first.
 */
const rpc = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../db', () => ({
  staffDb: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
  supabaseConfigured: () => true,
}));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({}) }));

const { parseDeclarationUpdate, UPDATE_DECLARATION_HREF } = await import('../declarationUpdate');
const { updateDeclaration } = await import('../declaration-actions');
const { buildDocumentsView } = await import('../model');
const { UpdateDeclarationForm } = await import('../_components/UpdateDeclarationForm');

beforeEach(() => rpc.mockReset());

const yes = (reviewStatus: string, source = 'onboarding') => ({
  declarations: [
    {
      id: 'decl-1',
      source,
      answer: true,
      declaredAt: '2026-09-18T09:00:00+00:00',
      reviewStatus,
      superseded: false,
    },
  ],
});

const update = (over: Record<string, unknown>) =>
  parseDeclarationUpdate({
    declarationId: 'decl-1',
    source: 'onboarding',
    answer: true,
    status: 'rejected',
    message: null,
    askedAt: null,
    canUpdate: true,
    pausesShifts: true,
    ...over,
  });

describe('parseDeclarationUpdate', () => {
  it('keeps what the worker may see, and nothing else', () => {
    const parsed = parseDeclarationUpdate({
      declarationId: 'decl-1',
      source: 'in_employment',
      status: 'details_requested',
      message: 'What was the sentence?',
      askedAt: '2026-10-22T09:00:00Z',
      canUpdate: true,
      pausesShifts: false,
      details: 'must not survive',
    });
    expect(parsed).toEqual({
      declarationId: 'decl-1',
      source: 'in_employment',
      status: 'details_requested',
      message: 'What was the sentence?',
      askedAt: '2026-10-22T09:00:00Z',
      canUpdate: true,
      pausesShifts: false,
    });
  });

  it('reads no answer as nothing to answer', () => {
    expect(parseDeclarationUpdate(null)).toBeNull();
    expect(parseDeclarationUpdate({})).toBeNull();
    expect(update({ canUpdate: 'yes' })?.canUpdate).toBe(false);
  });
});

describe('the Documents declaration row', () => {
  it('offers Update your declaration to staff whose declaration was rejected', () => {
    const view = buildDocumentsView({ ...data(yes('rejected')), declarationUpdate: update({}) });
    const row = view.rows.find((r) => r.kind === 'criminal_declaration');
    expect(row?.action).toEqual({
      label: 'Update your declaration',
      href: UPDATE_DECLARATION_HREF,
      primary: true,
    });
    expect(row?.meta).toBe('Not accepted as it was — please update it with the full details');
    expect(view.attention?.headline).toBe('1 document needs your attention.');
  });

  it('shows the office’s message when it asked for more detail', () => {
    const view = buildDocumentsView({
      ...data({ ...yes('details_requested', 'in_employment'), status: 'blocked' }),
      declarationUpdate: update({ status: 'details_requested', message: 'Which court?' }),
    });
    const row = view.rows.find((r) => r.kind === 'criminal_declaration');
    expect(row?.meta).toBe('The office needs more detail: “Which court?”');
    expect(row?.action?.href).toBe('/documents/declare');
  });

  it('offers nothing when the database says they may not answer', () => {
    const view = buildDocumentsView({
      ...data(yes('rejected', 'in_employment')),
      declarationUpdate: update({ canUpdate: false }),
    });
    const row = view.rows.find((r) => r.kind === 'criminal_declaration');
    expect(row?.action).toBeNull();
    expect(row?.meta).toBe('Reviewed — the office will be in touch');
  });

  it('ignores an answer about another declaration', () => {
    const view = buildDocumentsView({
      ...data(yes('rejected')),
      declarationUpdate: update({ declarationId: 'decl-0' }),
    });
    expect(view.rows.find((r) => r.kind === 'criminal_declaration')?.action).toBeNull();
  });
});

describe('updateDeclaration', () => {
  it('sends nothing without details', async () => {
    expect((await updateDeclaration('   ', null)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls the worker’s own door, with no staff id and the details trimmed', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await updateDeclaration('  Fine, 2016 — paid ', '2016-05-01')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('update_my_declaration', {
      p_details: 'Fine, 2016 — paid',
      p_conviction_date: '2016-05-01',
    });
  });

  it('words every refusal', async () => {
    const refusal = async () => {
      const result = await updateDeclaration('x', null);
      return result.ok ? '' : result.message;
    };
    rpc.mockResolvedValue({ data: { ok: false, reason: 'not_eligible' }, error: null });
    expect(await refusal()).toMatch(/can’t be updated/);
    rpc.mockResolvedValue({ data: null, error: { message: 'unknown_staff' } });
    expect(await refusal()).toMatch(/couldn’t find your record/);
  });
});

describe('UpdateDeclarationForm', () => {
  it('shows the office’s message, word for word', () => {
    const html = renderToStaticMarkup(
      <UpdateDeclarationForm
        status="details_requested"
        message="Please tell us the date and the sentence."
        pausesShifts={false}
        today="2026-10-22"
        after="/onboarding"
      />,
    );
    expect(html).toContain('The office needs a bit more detail about your declaration.');
    expect(html).toContain('“Please tell us the date and the sentence.”');
    expect(html).not.toContain('paused');
  });

  it('tells a compliant worker their shifts pause', () => {
    const html = renderToStaticMarkup(
      <UpdateDeclarationForm
        status="rejected"
        message={null}
        pausesShifts
        today="2026-10-22"
        after="/documents"
      />,
    );
    expect(html).toContain('The office couldn’t accept your declaration as it was.');
    expect(html).toContain('<b>paused</b>');
  });
});
