import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { EventFilters } = await import('../_components/EventFilters');
const { parseEventQuery } = await import('../_lib/filters');

const TODAY = '2026-09-25';

describe('Scheduling shows no cancelled events (ADR-0099)', () => {
  const html = renderToStaticMarkup(
    <EventFilters query={parseEventQuery({ status: 'cancelled' }, TODAY)} clients={[]} />,
  );

  it('has no Hide cancelled switch and no Cancelled status to pick', () => {
    expect(html).not.toContain('Hide cancelled');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('>Cancelled<');
    expect(html).toContain('>Upcoming<');
  });

  it('opens on Any status for a link that asks for Cancelled', () => {
    expect(html).toContain('<option value="" selected="">Any status</option>');
  });
});
