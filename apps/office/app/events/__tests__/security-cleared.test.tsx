import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUFFER_RULE, requiresReconfirmation } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0185 in the Shift Builder: the "Security cleared event" tick box
 * (staff bring a passport or driving licence), what saving writes, and that
 * ticking it re-confirms nobody. The confirmation push itself is the
 * database's (SC1, pgTAP 922).
 */
const state = vi.hoisted(() => ({
  eventRows: [] as Record<string, unknown>[],
  eventUpdates: [] as Record<string, unknown>[],
}));

function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (value: unknown) => unknown) => resolve(result);
      return () => proxy;
    },
  });
  return proxy;
}

function fakeDb() {
  return {
    rpc: async () => ({ data: { queued: true }, error: null }),
    from(table: string) {
      switch (table) {
        case 'clients':
          return chain({ data: { pays_breaks: true, pays_buffer: true } });
        case 'venues':
          return chain({
            data: { name: 'V', address: 'A', location: '0101', geofence_radius_m: 150 },
          });
        case 'events':
          return new Proxy(function () {}, {
            get(_t, prop) {
              if (prop === 'insert') {
                return (value: Record<string, unknown>) => {
                  state.eventRows.push(value);
                  return chain({ data: { id: 'evt-new' }, error: null });
                };
              }
              if (prop === 'update') {
                return (value: Record<string, unknown>) => {
                  state.eventUpdates.push(value);
                  return chain({ error: null });
                };
              }
              return () => chain({ data: { id: 'evt-new' }, error: null });
            },
          });
        case 'shift_requirements':
          return new Proxy(function () {}, {
            get() {
              return () => chain({ data: [], error: null });
            },
          });
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
}

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('../db', () => ({ eventsDb: () => fakeDb(), supabaseConfigured: () => true }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { createEvent } = await import('../actions');
const { ShiftBuilder } = await import('../_components/ShiftBuilder');
const { draftFromSaved, securityClearedToTell } = await import('../draft');
import type { EventDraft } from '../draft';
import type { SavedEvent } from '../data';

const DRAFT: EventDraft = {
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Spring Gala',
  date: '2026-11-21',
  overallStart: '09:00',
  overallEnd: '17:00',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  requiredLanguages: ['English'],
  securityCleared: false,
  duplicateOf: null,
  roles: [],
};

const REFERENCE = { clients: [], venues: [], roles: [], bufferRule: DEFAULT_BUFFER_RULE };

function builder(
  initial: EventDraft,
  over: { mode?: 'new' | 'edit'; confirmed?: Record<string, number>; locked?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <TimeFormatProvider format="24h">
      <ShiftBuilder
        mode={over.mode ?? 'new'}
        reference={REFERENCE}
        initial={initial}
        saved={null}
        confirmed={over.confirmed ?? {}}
        booked={{}}
        held={{}}
        locked={over.locked ?? false}
        ratesVisible
        save={async () => ({ error: 'unused' })}
      />
    </TimeFormatProvider>,
  );
}

const input = (securityCleared: boolean) => ({
  id: null,
  clientId: 'client-1',
  venueId: 'venue-1',
  title: 'Spring Gala',
  date: '2026-11-21',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  requiredLanguages: ['English'],
  securityCleared,
  duplicateOf: null,
  roles: [
    {
      id: null,
      roleId: 'role-bar',
      start: '09:00',
      end: '17:00',
      headcount: 2,
      buffer: 0,
      chargeRate: 20,
      payRate: 12,
      dressCode: '',
      autoAssign: true,
      requiredGender: null,
      sameStaffAllDays: false,
      allocationPerHour: 2,
    },
  ],
});

beforeEach(() => {
  state.eventRows.length = 0;
  state.eventUpdates.length = 0;
});

describe('the Security cleared tick box (ADR-0185)', () => {
  it('is a real, unticked checkbox on a new event, worded as the ask', () => {
    const html = builder(DRAFT);
    expect(html).toContain('Security cleared event');
    expect(html).toContain('staff must bring a passport or driving licence');
    const box = /<input[^>]*class="check-input"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('type="checkbox"');
    expect(box).not.toContain('checked');
  });

  it('is ticked when the event is saved with it', () => {
    const html = builder({ ...DRAFT, securityCleared: true });
    const box = /<input[^>]*class="check-input"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('checked');
  });

  it('is read-only once the event has started, like the other event-level asks', () => {
    // ShiftBuilder reads `locked` to decide it is read-only (the started event).
    const html = builder({ ...DRAFT, securityCleared: true }, { mode: 'edit', locked: true });
    const box = /<input[^>]*class="check-input"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('disabled');
  });

  it('does not warn about anyone when it is already ticked on the saved event', () => {
    const html = builder(
      { ...DRAFT, securityCleared: true },
      { mode: 'edit', confirmed: { 'sec-1': 2 } },
    );
    expect(html).not.toContain('told when you save');
  });
});

describe('who is told when it is ticked on a saved event', () => {
  const off = { securityCleared: false };
  const on = { securityCleared: true };

  it('is everyone confirmed, when the box goes from unticked to ticked', () => {
    expect(securityClearedToTell(off, on, 3)).toBe(3);
  });

  it('is nobody when it was already ticked, is still unticked, or is cleared', () => {
    expect(securityClearedToTell(on, on, 3)).toBe(0);
    expect(securityClearedToTell(off, off, 3)).toBe(0);
    expect(securityClearedToTell(on, off, 3)).toBe(0);
  });

  it('is nobody on an event with nobody confirmed', () => {
    expect(securityClearedToTell(off, on, 0)).toBe(0);
  });
});

describe('saving it', () => {
  it('writes security_cleared on the new event, true and false', async () => {
    // createEvent ends in a redirect to the new event's board.
    await createEvent(input(true)).catch(() => undefined);
    await createEvent(input(false)).catch(() => undefined);
    expect(state.eventRows[0]).toMatchObject({ security_cleared: true });
    expect(state.eventRows[1]).toMatchObject({ security_cleared: false });
  });

  it('re-confirms nobody — it asks the booked to bring ID, it does not move the shift', () => {
    expect(requiresReconfirmation('security_cleared')).toBe(false);
  });

  it('a Duplicate and a reopened event keep it', () => {
    const saved: SavedEvent = {
      id: 'ev-gala',
      clientId: 'client-1',
      venueId: 'venue-1',
      title: 'Spring Gala',
      date: '2026-11-21',
      poNumber: '',
      onsiteContact: '',
      notes: '',
      autoAssign: true,
      requiredLanguages: ['English'],
      securityCleared: true,
      cancelledAt: null,
      seriesDays: [],
      sections: [],
    };
    for (const as of ['edit', 'duplicate'] as const) {
      expect(draftFromSaved(saved, () => [], as).securityCleared).toBe(true);
    }
  });
});
