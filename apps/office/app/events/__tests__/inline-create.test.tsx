import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EventDraft } from '../draft';
import type { ReferenceData } from '../data';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('../../clients/actions', () => ({
  createClientRecord: vi.fn(),
  updateClientRecord: vi.fn(),
}));

const { ShiftBuilder } = await import('../_components/ShiftBuilder');

const REFERENCE: ReferenceData = {
  clients: [],
  venues: [],
  venueTypes: [{ key: 'hotel', label: 'Hotel', default_radius_m: 150, sort_order: 1 }],
  roles: [],
};

const BLANK: EventDraft = {
  clientId: '',
  venueId: '',
  title: '',
  date: '',
  overallStart: '07:00',
  overallEnd: '23:30',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  roles: [],
};

function render(
  props: { reference?: ReferenceData; locked?: boolean; mode?: 'new' | 'edit' } = {},
): string {
  return renderToStaticMarkup(
    <ShiftBuilder
      mode={props.mode ?? 'new'}
      reference={props.reference ?? REFERENCE}
      initial={BLANK}
      saved={null}
      confirmed={{}}
      booked={{}}
      locked={props.locked ?? false}
      ratesVisible
      save={async () => ({ error: 'unused' })}
    />,
  );
}

/**
 * §3.2 starts an event with "client → venue". A client or venue that does not
 * exist yet is added from the builder itself, not by leaving it and losing
 * the form.
 */
describe('adding a client or venue from the Shift Builder', () => {
  it('offers both on a new event', () => {
    const html = render();
    expect(html).toContain('+ New client');
    expect(html).toContain('+ New venue');
  });

  it('and on an edit, where the venue can change until the event starts (§3.5)', () => {
    const html = render({ mode: 'edit' });
    expect(html).toContain('+ New client');
    expect(html).toContain('+ New venue');
  });

  it('but not once the event has started and nothing can change (§3.2)', () => {
    const html = render({ locked: true });
    expect(html).not.toContain('+ New client');
    expect(html).not.toContain('+ New venue');
  });

  it('offers no new venue where the venue types could not be read', () => {
    const html = render({ reference: { ...REFERENCE, venueTypes: [] } });
    expect(html).toContain('+ New client');
    expect(html).not.toContain('+ New venue');
  });
});
