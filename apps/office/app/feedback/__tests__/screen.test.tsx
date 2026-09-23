import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FeedbackPageData } from '../data';
import type { FeedbackEntry, FeedbackQuery } from '../types';

// Outside Next there is no router and no server; neither is under test.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({
  markRead: vi.fn(),
  addOfficeFeedback: vi.fn(),
  updateOfficeFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
  searchWorkers: vi.fn(async () => []),
  workerEvents: vi.fn(async () => []),
}));

const { FeedbackScreen } = await import('../FeedbackScreen');

const BASE: FeedbackEntry = {
  id: 'f1',
  author_kind: 'client',
  rating: 2,
  text: 'Did not turn up.',
  created_at: '2026-09-18T08:12:00Z',
  updated_at: null,
  read_at: null,
  read_by_name: null,
  unread: true,
  counts_toward_rating: false,
  editable: false,
  deletable: false,
  author_id: 'u1',
  author_name: 'Sophie L.',
  staff_id: 's1',
  staff_name: 'Kai N.',
  employee_id: 811,
  staff_removed: false,
  staff_removed_at: null,
  event_id: 'e1',
  event_title: 'Press Night',
  event_date: '2026-09-17',
  venue_name: 'Mandarin Oriental',
  client_id: 'c1',
  client_name: 'Mandarin Oriental',
  role_names: 'Waiting Staff',
};

const DATA: FeedbackPageData = {
  entries: [],
  total: 0,
  unread: 0,
  clients: [],
  authors: [],
  managerName: 'Gisela M.',
  problem: null,
};

const CLIENT_TAB: FeedbackQuery = {
  tab: 'client',
  q: '',
  clientId: '',
  status: 'all',
  authorId: '',
  page: 1,
};

function render(entries: FeedbackEntry[], query = CLIENT_TAB, unread = 0): string {
  return renderToStaticMarkup(
    <FeedbackScreen data={{ ...DATA, entries, total: entries.length, unread }} query={query} />,
  );
}

function count(markup: string, text: string): number {
  return markup.split(text).length - 1;
}

describe('/feedback — client tab (§9.10)', () => {
  it('offers Mark as read on an unread entry, and says it is not in the rating', () => {
    const markup = render([BASE], CLIENT_TAB, 1);
    expect(markup).toContain('>Mark as read</button>');
    expect(markup).toContain('Unread — not in rating');
  });

  it('offers nothing on a read one: it is in the rating, and read-only', () => {
    const markup = render([
      {
        ...BASE,
        unread: false,
        read_at: '2026-09-07T08:00:00Z',
        read_by_name: 'Gisela M.',
        counts_toward_rating: true,
      },
    ]);
    expect(markup).not.toContain('>Mark as read</button>');
    expect(markup).toContain('Read · Gisela M. · 07 Sep');
    expect(markup).not.toContain('>Edit<');
    expect(markup).not.toContain('>Delete<');
  });

  it('allows Delete on a client entry only once the worker has been removed (§1.7)', () => {
    const markup = render([
      {
        ...BASE,
        unread: false,
        read_at: '2026-09-14T08:00:00Z',
        counts_toward_rating: true,
        staff_removed: true,
        staff_removed_at: '2026-09-19T10:00:00Z',
        staff_name: 'Deleted account #1042',
        deletable: true,
      },
    ]);
    expect(count(markup, '>Delete<')).toBe(1);
    expect(markup).toContain('Deleted account #1042');
    // A removed worker's name is not a link to a profile with nothing on it.
    expect(markup).not.toContain('href="/staff/s1"');
  });

  it('shows the unread count on the tab and in the Unread filter', () => {
    const markup = render([BASE], CLIENT_TAB, 4);
    expect(count(markup, '<span class="n alert">4</span>')).toBe(2);
  });

  it('shows no badge when nothing is unread', () => {
    expect(render([])).not.toContain('class="n');
  });

  it('has no office form on the client tab', () => {
    expect(render([BASE])).not.toContain('New feedback');
  });
});

describe('/feedback — office tab (§9.10)', () => {
  const OFFICE_TAB: FeedbackQuery = { ...CLIENT_TAB, tab: 'office' };
  const OFFICE: FeedbackEntry = {
    ...BASE,
    id: 'o1',
    author_kind: 'office',
    rating: 4,
    unread: false,
    counts_toward_rating: true,
    editable: true,
    deletable: true,
    author_name: 'Ben A.',
    event_id: null,
    event_title: null,
    event_date: null,
    client_id: null,
    client_name: null,
    role_names: null,
  };

  it('names the manager as author, and offers Edit and Delete — never Mark as read', () => {
    const markup = render([OFFICE], OFFICE_TAB);
    expect(markup).toContain('>Ben A.<');
    expect(markup).toContain('>Edit<');
    expect(markup).toContain('>Delete<');
    expect(markup).not.toContain('>Mark as read</button>');
    expect(markup).toContain('Not tied to an event');
  });

  it('carries the New feedback form, authored by the signed-in manager', () => {
    const markup = render([OFFICE], OFFICE_TAB);
    expect(markup).toContain('New feedback');
    expect(markup).toContain('author: Gisela M.');
  });

  it('searches by staff name on both tabs', () => {
    expect(render([], OFFICE_TAB)).toContain('placeholder="Search by staff name"');
    expect(render([])).toContain('placeholder="Search by staff name"');
  });
});
