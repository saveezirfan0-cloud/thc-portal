import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleDraft } from '../draft';
import type { ClientOption, RoleOption } from '../data';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RoleSection } = await import('../_components/RoleSection');
const { ClientPolicies } = await import('../_components/SummaryPanel');

const roles: RoleOption[] = [{ id: 'role-host', name: 'Host', payRate: 12 }];
const client: ClientOption = {
  id: 'client-excel',
  name: 'ExCeL London',
  staffContactPoint: 'Dana R.',
  contactEmails: [],
  paysBreaks: false,
  paysBuffer: true,
  rateCard: { 'role-host': { chargeRate: 20, dressCodes: ['Smart black'] } },
};

function role(over: Partial<RoleDraft> = {}): RoleDraft {
  return {
    key: 'r1',
    id: 'sec-1',
    roleId: 'role-host',
    start: '08:00',
    end: '16:00',
    headcount: 4,
    buffer: 0,
    chargeRate: 20,
    payRate: 12,
    dressCode: 'Smart black',
    dressCodeOther: '',
    autoAssign: true,
    allocationPerHour: 4,
    allocationTouched: true,
    ...over,
  };
}

function render(over: Partial<Parameters<typeof RoleSection>[0]> = {}) {
  return renderToStaticMarkup(
    <RoleSection
      mode="edit"
      index={0}
      role={role()}
      date="2026-09-18"
      issues={[]}
      roles={roles}
      client={client}
      confirmed={0}
      booked={0}
      changed={new Set()}
      original={role()}
      locked={false}
      onChange={() => undefined}
      onRemove={() => undefined}
      {...over}
    />,
  );
}

describe('the pill on a locked section follows the event status (§1.5, docs/07)', () => {
  it('is green Ongoing while the event runs (shift-builder.html:320)', () => {
    const html = render({ locked: true, status: 'ongoing' });
    expect(html).toContain('Ongoing');
    expect(html).toMatch(/class="pill green"[^>]*>Ongoing/);
  });

  it('is neutral Completed for a past event, never Ongoing', () => {
    const html = render({ locked: true, status: 'completed' });
    expect(html).toContain('Completed');
    expect(html).not.toContain('Ongoing');
    expect(html).not.toMatch(/pill green/);
  });

  it('is neutral Cancelled for a cancelled event', () => {
    const html = render({ locked: true, status: 'cancelled' });
    expect(html).toContain('Cancelled');
    expect(html).not.toContain('Ongoing');
  });
});

describe('the edit-state cues (§3.2, §3.5; shift-builder.html:261-273)', () => {
  it('strikes the old start through beside the new one and marks the input', () => {
    const html = render({
      role: role({ start: '07:30' }),
      original: role(),
      changed: new Set(['starts_at']),
    });
    expect(html).toContain('<s>08:00</s>');
    expect(html).toMatch(/class="hint"><span class="amber">was 08:00/);
    expect(html).toMatch(/class="input mono was"/);
  });

  it('warns as soon as the headcount is cut with people confirmed, above them or not', () => {
    const above = render({
      role: role({ headcount: 10 }),
      original: role({ headcount: 12 }),
      confirmed: 9,
      changed: new Set(['headcount']),
    });
    expect(above).toContain('Headcount 12 → 10 with 9 confirmed');
    expect(above).toContain('if it later drops below the confirmed count');

    const below = render({
      role: role({ headcount: 8 }),
      original: role({ headcount: 12 }),
      confirmed: 9,
      changed: new Set(['headcount']),
    });
    expect(below).toContain('it is now below the confirmed count');
    expect(below).toContain('withdraws 1 person by hand');
  });

  it('stays quiet when the headcount was raised, or nobody is confirmed', () => {
    expect(
      render({ role: role({ headcount: 14 }), original: role(), changed: new Set(['headcount']) }),
    ).not.toContain('nobody is auto-removed');
    expect(
      render({
        role: role({ headcount: 2 }),
        original: role(),
        confirmed: 0,
        changed: new Set(['headcount']),
      }),
    ).not.toContain('nobody is auto-removed');
  });

  it('offers no "Choose…" placeholder where the rate card lists a dress code', () => {
    // The Role select keeps its own placeholder; only the dress code loses it.
    const placeholders = (html: string) => html.split('Choose…</option>').length - 1;
    expect(placeholders(render())).toBe(1);
    const noList = render({
      client: { ...client, rateCard: { 'role-host': { chargeRate: 20, dressCodes: [] } } },
      role: role({ dressCode: '' }),
    });
    expect(placeholders(noList)).toBe(2);
  });
});

describe('the client policies panel (§3.2; shift-builder.html:212-213)', () => {
  it('names RULE-15 on the paid-buffer line and links the client card', () => {
    const html = renderToStaticMarkup(
      <ClientPolicies clientId="client-excel" clientName="ExCeL London" paysBreaks paysBuffer />,
    );
    expect(html).toContain(
      'Everyone accepted works and is paid normally. Strict policy would turn away the surplus at check-in (RULE-15).',
    );
    expect(html).toContain('href="/clients/client-excel"');
  });
});
