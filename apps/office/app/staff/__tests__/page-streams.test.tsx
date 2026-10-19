import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffRow } from '../types';

/**
 * /staff paints its shell at once and streams the directory behind it
 * (ADR-0161): `staff_directory_v` computes every worker's weekly cap, the
 * slowest read on the screen. One `OfficeShell`, outside every Suspense —
 * a skeleton that drew its own put two topbars in the document (ADR-0109).
 */
const state = vi.hoisted(() => ({
  load: null as null | (() => Promise<unknown>),
  shells: 0,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/staff',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('../data', () => ({
  loadStaff: () => state.load!(),
  supabaseConfigured: () => true,
}));
vi.mock('../requests/data', () => ({ countPendingChangeRequests: async () => 3 }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../../_components/officeUser', () => ({ currentOfficeRole: async () => 'manager' }));
vi.mock('../../_components/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({
    title,
    crumbs,
    actions,
    children,
  }: {
    title: ReactNode;
    crumbs: ReactNode;
    actions: ReactNode;
    children: ReactNode;
  }) => {
    state.shells += 1;
    return (
      <main>
        <header>
          <h1>{title}</h1>
          <nav>{crumbs}</nav>
          <div className="actions">{actions}</div>
        </header>
        {children}
      </main>
    );
  },
}));

const { default: Page } = await import('../page');

const WORKER = {
  id: 'w1',
  employee_id: 873,
  status: 'compliant',
  removed: false,
  display_name: 'Amara K.',
  photo_path: null,
  photo_url: null,
  rating: 4.6,
  reliability: 98,
  block_kind: null,
  block_reason: null,
  rtw_branch: null,
  right_to_work_until: null,
  graduated_at: null,
  wtr_optout: false,
  left_at: null,
  leave_reason: null,
  role_names: ['Waiting Staff'],
  unresolved_violations: 0,
  do_not_return_clients: [],
  weekly_cap_hours: 48,
  weekly_cap_band: 'standard_48',
  weekly_booked_hours: 0,
  weekly_cap_until: null,
  last_shift_at: null,
  released_shift_count: 0,
  p45_requested_at: null,
} as unknown as StaffRow;

async function settled(node: ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node);
  let html = '';
  for await (const chunk of prelude) html += String(chunk);
  // React's text separators, so a sentence reads as it does on screen.
  return html.replace(/<!-- -->/g, '');
}

beforeEach(() => {
  state.shells = 0;
});

describe('/staff streams the directory behind its shell', () => {
  it('draws the shell, its links and a skeleton while the directory is still read', () => {
    state.load = () => new Promise(() => {});
    const html = renderToString(<Page />);
    expect(html).toContain('<h1>Staff</h1>');
    expect(html).toContain('href="/staff/roster"');
    expect(html).toContain('href="/staff/requests"');
    expect(html).toContain('Loading the staff directory');
    expect(html).not.toContain('Amara K.');
    expect(state.shells).toBe(1);
  });

  it('streams in the list, the counts and the change-request number — still one shell', async () => {
    state.load = async () => ({ staff: [WORKER], students: [], problem: null });
    const html = await settled(<Page />);
    expect(html).toContain('Amara K.');
    expect(html).toContain('<b>1 workers</b>');
    expect(html).toContain('Change requests (3)');
    expect(html).not.toContain('Loading the staff directory');
    expect(state.shells).toBe(1);
    expect(html.match(/<h1>/g)).toHaveLength(1);
  });
});
