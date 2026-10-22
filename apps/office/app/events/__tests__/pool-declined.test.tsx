// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WEIGHTS } from '@thc/domain';
import type { PoolEntry } from '../[id]/board-model';

vi.mock('../[id]/actions', () => ({
  inviteWorker: vi.fn(async () => ({ ok: true as const })),
  acceptApplication: vi.fn(async () => ({ ok: true as const })),
}));

/**
 * A worker who declined this section is invitable again (§3.6, D33) — but
 * the office must see that they said no. The earlier ending is a badge on
 * the row, not grey small print, and the button says it is a second ask.
 */
function entry(over: Partial<PoolEntry>): PoolEntry {
  return {
    staffId: 's1',
    name: 'Eve X.',
    roles: ['Waiting Staff'],
    rank: 1,
    wave: 1,
    qualified: true,
    breakdown: { show: 90, rating: 90, proximity: 90, fair: 90, venue: 90, total: 90 },
    input: { reliability: 90, rating: 4.5, distanceKm: 3, futureShifts: 0, venueTimes: 1 },
    appliedAt: null,
    applicationId: null,
    endedLabel: null,
    autoInvitable: true,
    ...over,
  };
}

async function render(entries: PoolEntry[]): Promise<string> {
  const { PotentialPool } = await import('../[id]/_components/PotentialPool');
  return renderToStaticMarkup(
    <PotentialPool
      eventId="evt-1"
      shiftId="sh-1"
      clientName="Spud Bros"
      roleName="Waiting Staff"
      entries={entries}
      weights={DEFAULT_WEIGHTS}
      problem={null}
      canInvite
    />,
  );
}

describe('Potential pool · an earlier decline is on the row', () => {
  it('shows Declined as a coral badge, says manual invite only, and offers Invite again', async () => {
    const html = await render([entry({ endedLabel: 'Declined', autoInvitable: false })]);
    expect(html).toContain('Declined earlier');
    expect(html).toMatch(/class="[^"]*\bcoral\b[^"]*"[^>]*>Declined earlier/);
    expect(html).toContain('manual invite only');
    expect(html).toContain('Invite again');
    expect(html).toContain('aria-label="Invite Eve X. again"');
  });

  it('a withdrawn invitation is flagged too, in amber', async () => {
    const html = await render([entry({ endedLabel: 'Withdrawn' })]);
    expect(html).toMatch(/class="[^"]*\bamber\b[^"]*"[^>]*>Withdrawn earlier/);
    expect(html).not.toContain('manual invite only');
  });

  it('a worker with no earlier booking keeps the plain Invite button and no badge', async () => {
    const html = await render([entry({})]);
    expect(html).toContain('aria-label="Invite Eve X."');
    expect(html).not.toContain('Invite again');
    expect(html).not.toContain('earlier');
  });
});
