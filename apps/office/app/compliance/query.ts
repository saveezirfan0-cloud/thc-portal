import type { CheckFilter } from './checks';
import type { RadarFilter, WhoFilter } from './queue';

/**
 * /compliance's state in the URL (release audit L1): the tab — `?tab=radar`
 * is the dashboard's "view radar →" (§9.1), `?tab=checks` the gov.uk
 * monitor — and each tab's own search, filters and page. All three tabs
 * read the same keys, so switching tab writes every other key back to its
 * default: a tab opens unfiltered, as it did before the state moved.
 */
export const COMPLIANCE_QUERY = {
  tab: 'review',
  q: '',
  who: 'all',
  doc: 'any',
  state: 'all',
  check: 'all',
  page: '1',
} as const satisfies Record<string, string>;

export type ComplianceTab = 'review' | 'radar' | 'checks';
export const TABS: readonly ComplianceTab[] = ['review', 'radar', 'checks'];
export const WHO: readonly WhoFilter[] = ['all', 'candidates', 'staff'];
export const RADAR_STATES: readonly RadarFilter[] = ['all', 'expired', 'expiring'];
export const CHECK_FILTERS: readonly CheckFilter[] = [
  'all',
  'progress',
  'review',
  'finished',
  'problems',
];
