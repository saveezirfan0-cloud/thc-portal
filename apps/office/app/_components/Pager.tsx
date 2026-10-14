'use client';

import { Button, Select } from '@thc/ui';
import './pager.css';

/**
 * The pager under a directory's table, inside its card: "Showing 1–25 of
 * 68", Prev / Next and Rows per page. The same control the Clients
 * directory draws (ADR-0124), for the lists that had none (release audit
 * L4: /venues, /staff/requests). Presentational only — the screen owns the
 * page and the size, and goes back to page 1 when a filter changes.
 */
export interface PagerProps {
  /** Rows after filtering. */
  total: number;
  /** Zero-based page, already clamped to the last page. */
  page: number;
  pageSize: number;
  sizes: readonly number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export function Pager({ total, page, pageSize, sizes, onPage, onPageSize }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = page * pageSize + 1;
  const last = Math.min(total, page * pageSize + pageSize);
  return (
    <div className="panel-h pager">
      <span className="muted sm">
        Showing {first}–{last} of {total}
      </span>
      <div className="right">
        <Button size="sm" tone="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </Button>
        <span className="mono sm">
          {page + 1} / {pages}
        </span>
        <Button
          size="sm"
          tone="ghost"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next ›
        </Button>
        <Select
          value={String(pageSize)}
          onChange={(event) => onPageSize(Number(event.target.value))}
          aria-label="Rows per page"
          style={{ width: 110 }}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
