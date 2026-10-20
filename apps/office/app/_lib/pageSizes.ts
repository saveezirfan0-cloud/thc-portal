/**
 * Rows-per-page on every paged office list: 100 is both the smallest choice
 * and the default, so a list opens a hundred rows deep (ADR-0175).
 */
export const LIST_PAGE_SIZES = [100, 250, 500] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number];
export const DEFAULT_LIST_PAGE_SIZE: ListPageSize = 100;
