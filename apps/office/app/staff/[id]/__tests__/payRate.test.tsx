import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLIDAY_RATE } from '@thc/domain';

/**
 * ADR-0072 · the personal pay rate on /staff/:id.
 *
 *   · the figures are /roles' own — base, holiday +12.07% broken out, final;
 *   · the card reads "Uses the role or event rate" when there is none, and
 *     offers Set / Edit / Clear only when editable;
 *   · the Overview draws the card for a finance role only (a scheduler
 *     never sees money, ADR-0061);
 *   · the actions send pounds to the penny through the SESSION (the
 *     database's finance gate decides), and null to clear.
 */

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as { message: string } | null,
}));

// Outside Next there is no router; the Overview's other cards ask for one.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { payRateFigures, payRateMessage, payRateSetLine, storedPence, HOLIDAY_LABEL } =
  await import('../payRate');
const { PayRateCard } = await import('../PayRateCard');
const { Overview } = await import('../Overview');
const { savePayRate, clearPayRate } = await import('../actions');

beforeEach(() => {
  rpc.mockClear();
  rpc.mockImplementation(async () => ({ error: null }));
});

describe('the figures (§9.8, §1.5)', () => {
  it('breaks the holiday out of the base and never blends it', () => {
    // £12.71: holiday round(1271 × 0.1207) = 153p, final £14.24.
    expect(payRateFigures(1271)).toEqual({ base: '£12.71', holiday: '+£1.53', final: '£14.24' });
  });

  it('labels the holiday from the one constant', () => {
    expect(HOLIDAY_RATE).toBe(0.1207);
    expect(HOLIDAY_LABEL).toBe('Holiday +12.07%');
  });

  it('reads numeric as a number or a string', () => {
    expect(storedPence({ pay_rate: 13.5 })).toBe(1350);
    expect(storedPence({ pay_rate: '12.71' })).toBe(1271);
  });

  it('stamps the change in UK time (§1.8)', () => {
    // 13:02 UTC in late September is 14:02 in London (BST).
    expect(payRateSetLine({ set_at: '2026-09-29T13:02:00Z' })).toBe('Set 29.09.2026 14:02 UK time');
  });

  it("turns the database refusals into the manager's words", () => {
    expect(payRateMessage('not_permitted')).toMatch(/not available for your role/);
    expect(payRateMessage('read_only')).toMatch(/not change anything/);
    expect(payRateMessage('staff_removed')).toMatch(/removed under GDPR/);
    expect(payRateMessage('A pay rate is set to the penny')).toMatch(/to the penny/);
    expect(payRateMessage('something else')).toBe('something else');
  });
});

describe('Pay rate card', () => {
  it('reads "Uses the role or event rate" with none, offering Set rate but not Clear', () => {
    const html = renderToStaticMarkup(<PayRateCard staffId="s1" payRate={null} editable />);
    expect(html).toContain('Uses the role or event rate');
    expect(html).toContain('>Set rate<');
    expect(html).not.toContain('>Clear<');
    expect(html).toContain('finance only');
  });

  it('shows the personal base rate with holiday and final rate derived, and Edit / Clear', () => {
    const html = renderToStaticMarkup(
      <PayRateCard
        staffId="s1"
        editable
        payRate={{ pay_rate: 12.71, set_at: '2026-09-29T13:02:00Z' }}
      />,
    );
    expect(html).toContain('Personal pay rate (base £/h)');
    expect(html).toContain('£12.71');
    expect(html).toContain('Holiday +12.07%');
    expect(html).toContain('+£1.53');
    expect(html).toContain('£14.24');
    expect(html).toContain('Set 29.09.2026 14:02 UK time');
    expect(html).toContain('>Edit<');
    expect(html).toContain('>Clear<');
    expect(html).not.toContain('Uses the role or event rate');
  });

  it('offers no controls when not editable (a viewer, a removed profile)', () => {
    const html = renderToStaticMarkup(
      <PayRateCard
        staffId="s1"
        editable={false}
        payRate={{ pay_rate: '13.50', set_at: '2026-09-29T13:02:00Z' }}
      />,
    );
    expect(html).toContain('£13.50');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('>Clear<');
    expect(html).not.toContain('>Set rate<');
  });

  it('says when the rate could not be read, rather than "uses the role rate"', () => {
    const html = renderToStaticMarkup(
      <PayRateCard staffId="s1" editable payRate={null} problem="permission denied" />,
    );
    expect(html).toContain('The pay rate could not be read: permission denied');
    expect(html).not.toContain('Uses the role or event rate');
  });
});

describe('the Overview draws the card for finance roles only (ADR-0061)', () => {
  const profile = {
    id: 's1',
    removed: false,
    display_name: 'Amelia Clarke',
    dob: null,
    joined_at: '2026-03-02',
    term_dates: null,
    weekly_cap_band: null,
    weekly_cap_hours: null,
    weekly_cap_until: null,
  } as unknown as Parameters<typeof Overview>[0]['profile'];

  it('no card for a scheduler', () => {
    const html = renderToStaticMarkup(
      <Overview profile={profile} references={[]} declarations={[]} showPayRate={false} />,
    );
    expect(html).not.toContain('Pay rate');
    expect(html).not.toContain('Uses the role or event rate');
  });

  it('the card for a manager, editable', () => {
    const html = renderToStaticMarkup(
      <Overview
        profile={profile}
        references={[]}
        declarations={[]}
        showPayRate
        canEditPayRate
        payRate={null}
      />,
    );
    expect(html).toContain('Uses the role or event rate');
    expect(html).toContain('>Set rate<');
  });

  it('no controls on a removed profile (§1.7)', () => {
    const html = renderToStaticMarkup(
      <Overview
        profile={{ ...profile, removed: true }}
        references={[]}
        declarations={[]}
        showPayRate
        canEditPayRate
        payRate={null}
      />,
    );
    expect(html).toContain('Uses the role or event rate');
    expect(html).not.toContain('>Set rate<');
  });
});

describe('the actions', () => {
  it('saves pounds to the penny through set_staff_pay_rate', async () => {
    await expect(savePayRate('s1', '£13.50')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_staff_pay_rate', { p_staff: 's1', p_pay_rate: 13.5 });
  });

  it('refuses a third decimal before reaching the database', async () => {
    const result = await savePayRate('s1', '12.715');
    expect(result).toEqual({ ok: false, message: 'Enter a rate to the penny, e.g. 13.50.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a blank or negative rate', async () => {
    expect((await savePayRate('s1', '')).ok).toBe(false);
    expect((await savePayRate('s1', '-1')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clears with null', async () => {
    await expect(clearPayRate('s1')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_staff_pay_rate', { p_staff: 's1', p_pay_rate: null });
  });

  it("shows a scheduler the database's refusal in words", async () => {
    rpc.mockImplementation(async () => ({ error: { message: 'not_permitted' } }));
    const result = await savePayRate('s1', '13.00');
    expect(result).toEqual({ ok: false, message: 'Pay rates are not available for your role.' });
  });
});
