import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0104 · the Payroll ID row on /staff/:id, and the action behind it.
 *
 *   · set: the ID in mono, and Edit;
 *   · none: "not set" and Set;
 *   · a viewer: the ID and nothing to press; a removed profile, or a failed
 *     read: "—";
 *   · the action sends the ID (or null to clear) through the SESSION and
 *     names refusals in sentences, never codes.
 */
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as { message: string } | null,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { PayrollIdField } = await import('../PayrollIdField');
const { savePayrollId } = await import('../actions');

beforeEach(() => {
  rpc.mockClear();
  rpc.mockImplementation(async () => ({ error: null }));
});

const render = (props: Partial<Parameters<typeof PayrollIdField>[0]>) =>
  renderToStaticMarkup(<PayrollIdField staffId="st-1" payrollId="1641A" editable {...props} />);

describe('the Payroll ID row (ADR-0104)', () => {
  it('shows the ID and offers Edit', () => {
    const html = render({});
    expect(html).toContain('1641A');
    expect(html).toContain('>Edit<');
  });

  it('none on file: "not set" and Set', () => {
    const html = render({ payrollId: null });
    expect(html).toContain('not set');
    expect(html).toContain('>Set<');
  });

  it('a viewer reads it and has nothing to press', () => {
    const html = render({ editable: false });
    expect(html).toContain('1641A');
    expect(html).not.toContain('<button');
  });

  it('a removed profile or a failed read shows a dash', () => {
    expect(render({ removed: true })).toBe('<span class="muted">—</span>');
    expect(render({ payrollId: undefined })).toBe('<span class="muted">—</span>');
  });
});

describe('savePayrollId', () => {
  it('sends the ID to set_staff_payroll_id', async () => {
    expect(await savePayrollId('st-1', '1641A')).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_staff_payroll_id', {
      p_staff: 'st-1',
      p_payroll_id: '1641A',
    });
  });

  it('null clears it', async () => {
    await savePayrollId('st-1', null);
    expect(rpc).toHaveBeenCalledWith('set_staff_payroll_id', {
      p_staff: 'st-1',
      p_payroll_id: null,
    });
  });

  it('names a refusal in a sentence, never the code', async () => {
    for (const code of [
      'payroll_id_taken',
      'payroll_id_shape',
      'read_only',
      'not_authorised',
      'staff_removed',
    ]) {
      rpc.mockImplementationOnce(async () => ({ error: { message: code } }));
      const result = await savePayrollId('st-1', 'X1');
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).not.toBe(code);
    }
  });
});
