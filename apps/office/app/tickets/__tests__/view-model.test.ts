import { describe, expect, it } from 'vitest';
import {
  ilikePattern,
  isOpen,
  parseQuery,
  ticketNumberOf,
  ticketRef,
  ticketsHref,
  validateDraft,
} from '../view-model';

const draft = { kind: 'bug', severity: '', title: 'Card vanishes', details: '', link: '' };

describe('ticket references', () => {
  it('writes the id the team quotes', () => {
    expect(ticketRef(12)).toBe('TK-12');
  });

  it('reads a search as a ticket number only when it is one', () => {
    expect(ticketNumberOf('TK-12')).toBe(12);
    expect(ticketNumberOf('tk12')).toBe(12);
    expect(ticketNumberOf(' 7 ')).toBe(7);
    expect(ticketNumberOf('kanban 7')).toBeNull();
    expect(ticketNumberOf('')).toBeNull();
  });

  it('counts New, In progress and Waiting as open', () => {
    expect(['new', 'in_progress', 'waiting'].map((s) => isOpen(s as 'new'))).toEqual([
      true,
      true,
      true,
    ]);
    expect(isOpen('resolved')).toBe(false);
    expect(isOpen('closed')).toBe(false);
  });
});

describe('validateDraft — the same rules create_ticket() holds', () => {
  it('lets a plain report through, severity and link optional', () => {
    expect(validateDraft(draft)).toBeNull();
    expect(
      validateDraft({ ...draft, severity: 'high', link: 'https://www.loom.com/share/abc' }),
    ).toBeNull();
  });

  it('wants a kind from the list', () => {
    expect(validateDraft({ ...draft, kind: 'rant' })).toMatch(/kind/);
  });

  it('wants a summary of 3 to 200 characters', () => {
    expect(validateDraft({ ...draft, title: '  a ' })).toMatch(/summary is required/);
    expect(validateDraft({ ...draft, title: 'x'.repeat(201) })).toMatch(/at most 200/);
  });

  it('caps the details at 5,000', () => {
    expect(validateDraft({ ...draft, details: 'x'.repeat(5001) })).toMatch(/5,000/);
  });

  it('refuses a severity off the list and a link that is not http(s)', () => {
    expect(validateDraft({ ...draft, severity: 'meh' })).toMatch(/how bad/);
    expect(validateDraft({ ...draft, link: 'javascript:alert(1)' })).toMatch(/https:\/\//);
    expect(validateDraft({ ...draft, link: 'https://a b' })).toMatch(/https:\/\//);
  });
});

describe('the list address', () => {
  it('defaults to the Open tab, first page, no filters', () => {
    expect(parseQuery({})).toEqual({
      tab: 'open',
      q: '',
      kind: null,
      severity: null,
      status: null,
      page: 1,
    });
  });

  it('drops anything it does not recognise instead of trusting it', () => {
    const query = parseQuery({
      tab: 'everything',
      kind: 'rant',
      severity: 'meh',
      status: 'lost',
      page: '-3',
    });
    expect(query).toMatchObject({ tab: 'open', kind: null, severity: null, status: null, page: 1 });
  });

  it('round-trips a query, leaving defaults out', () => {
    const query = parseQuery({ tab: 'closed', q: 'kanban', kind: 'bug', page: '2' });
    expect(ticketsHref(query)).toBe('/tickets?tab=closed&q=kanban&kind=bug&page=2');
    expect(ticketsHref({ tab: 'open' })).toBe('/tickets');
  });

  it('escapes a search for ilike and strips the or() grammar', () => {
    expect(ilikePattern('50%_off')).toBe('%50\\%\\_off%');
    expect(ilikePattern('a,b(c)')).toBe('%a b c%');
  });
});
