import { cache } from 'react';
import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { currentTimeFormat } from '../_lib/timeFormat';
import { loadDashboard } from './data';
import { loadShortStaffed } from './short-staffed-data';

/**
 * Everything the Dashboard reads, once per request.
 *
 * The page is a shell (topbar, chrome) that paints at once and a body that
 * streams in behind it, and both the topbar's "as of" line and the body need
 * the same figures. `cache` makes the second caller share the first's reads
 * rather than repeat them.
 */
export const dashboardView = cache(async () => {
  // ADR-0056: a scheduler sees no money — no weekly snapshot, no margin
  // on the ten-day list. The views withhold it too; this drops the panel
  // rather than drawing it empty.
  //
  // The short-staffed read and the clock do not depend on the role, so they
  // start now rather than after it resolves.
  const shortStaffedRead = loadShortStaffed();
  const formatRead = currentTimeFormat();
  const showMoney = officeCan(await currentOfficeRole(), 'finance');
  const [dashboard, shortStaffed, format] = await Promise.all([
    loadDashboard({ finance: showMoney }),
    shortStaffedRead,
    formatRead,
  ]);
  return { showMoney, ...dashboard, shortStaffed, format };
});
