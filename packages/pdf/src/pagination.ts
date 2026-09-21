/**
 * Allocation sheet and sign-out timesheet paging — Scope §11.3.
 *
 * Twelve worker rows per page, always. The last page is not padded, but an
 * exact multiple never produces a trailing empty page.
 *
 * Phase 0 ships the paging rule and its tests; the `reports` bot builds the
 * renderer itself in Phase 6.
 */
export const ROWS_PER_PAGE = 12;

export function paginate<T>(rows: readonly T[], perPage: number = ROWS_PER_PAGE): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) {
    pages.push(rows.slice(i, i + perPage));
  }
  return pages;
}

export function pageCount(rowCount: number, perPage: number = ROWS_PER_PAGE): number {
  return Math.max(1, Math.ceil(rowCount / perPage));
}
