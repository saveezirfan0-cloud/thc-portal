import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0106 · the Scheduling row on /staff/:id, and the action behind it.
 *
 *   · an ordinary worker: "THC shifts" and a button to mark them SpudBros
 *     Express staff;
 *   · onboarding only: the label in the words of the onboarding email and
 *     a button that switches THC shifts on;
 *   · switched on: says so, and offers to switch them off;
 *   · a viewer: the label and nothing to press; a removed profile, or a
 *     failed read: "—";
 *   · the action sends the three values through the SESSION and names
 *     refusals in sentences, never codes.
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

const { SchedulingField, SPUDBROS_LABEL } = await import('../SchedulingField');
const { saveScheduling } = await import('../actions');

beforeEach(() => {
  rpc.mockClear();
  rpc.mockImplementation(async () => ({ error: null }));
});

const render = (props: Partial<Parameters<typeof SchedulingField>[0]>) =>
  renderToStaticMarkup(
    <SchedulingField staffId="st-1" spudbros={false} thcShifts={false} editable {...props} />,
  );

describe('the Scheduling row (ADR-0106)', () => {
  it('the label is the one the onboarding email promised', () => {
    expect(SPUDBROS_LABEL).toBe('SpudBros Express Staff Only – scheduling on Connecteam');
  });

  it('an ordinary worker: THC shifts, and a way to mark them as SpudBros staff', () => {
    const html = render({});
    expect(html).toContain('THC shifts');
    expect(html).toContain('Mark as SpudBros Express staff');
    expect(html).not.toContain(SPUDBROS_LABEL);
  });

  it('onboarding only: the label, the rule in words, and Switch on THC shifts', () => {
    const html = render({ spudbros: true, thcShifts: false });
    expect(html).toContain(SPUDBROS_LABEL);
    expect(html).toContain('Switch on THC shifts');
    expect(html).toContain('Not SpudBros staff');
    expect(html).toContain('Not offered, invited or auto-assigned');
  });

  it('switched on: says so and offers to switch off', () => {
    const html = render({ spudbros: true, thcShifts: true });
    expect(html).toContain('SpudBros Express · also works THC shifts');
    expect(html).toContain('Switch off THC shifts');
    expect(html).not.toContain(SPUDBROS_LABEL);
  });

  it('a viewer reads it and has nothing to press', () => {
    const html = render({ spudbros: true, thcShifts: false, editable: false });
    expect(html).toContain(SPUDBROS_LABEL);
    expect(html).not.toContain('<button');
  });

  it('a removed profile or a failed read shows a dash', () => {
    expect(render({ removed: true })).toBe('<span class="muted">—</span>');
    expect(render({ spudbros: undefined, thcShifts: undefined })).toBe(
      '<span class="muted">—</span>',
    );
  });
});

describe('saveScheduling', () => {
  it('sends the pair to set_staff_scheduling', async () => {
    expect(await saveScheduling('st-1', true, true)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_staff_scheduling', {
      p_staff: 'st-1',
      p_spudbros: true,
      p_thc_shifts: true,
    });
  });

  it('names a refusal in a sentence, never the code', async () => {
    for (const code of ['has_upcoming_shifts', 'read_only', 'not_authorised', 'staff_removed']) {
      rpc.mockImplementationOnce(async () => ({ error: { message: code } }));
      const result = await saveScheduling('st-1', true, false);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).not.toBe(code);
    }
  });

  it('tells the office what to do about an upcoming shift', async () => {
    rpc.mockImplementationOnce(async () => ({ error: { message: 'has_upcoming_shifts' } }));
    const result = await saveScheduling('st-1', true, false);
    expect(result.ok ? '' : result.message).toMatch(/cancel or move/i);
  });
});
