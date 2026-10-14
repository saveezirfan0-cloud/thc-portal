'use client';

import { useRef } from 'react';
import { Button, Select } from '@thc/ui';
import './pager.css';

/**
 * The pager under a directory's table, inside its card: "Showing 1–25 of
 * 68", Prev / Next and Rows per page. The same control the Clients
 * directory draws (ADR-0124), for the lists that had none (release audit
 * L4: /venues, /staff/requests). Presentational only — the screen owns the
 * page and the size, and goes back to page 1 when a filter changes.
 *
 * Turning the page brings the top of the list back into view (release
 * audit L5): the buttons sit under the last row, and the new page used to
 * open with the reader already at its bottom.
 */
export interface PagerProps {
  /** Rows after filtering. */
  total: number;
  /** Zero-based page, already clamped to the last page. */
  page: number;
  pageSize: number;
  /** Rows-per-page choices; none draws no Rows per page select. */
  sizes?: readonly number[];
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}

export function Pager({ total, page, pageSize, sizes, onPage, onPageSize }: PagerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, page * pageSize + pageSize);
  const turn = (to: number) => {
    onPage(to);
    scrollToListTop(ref.current);
  };
  return (
    <div className="panel-h pager" ref={ref}>
      <span className="muted sm">
        Showing {first}–{last} of {total.toLocaleString('en-GB')}
      </span>
      <div className="right">
        <Button size="sm" tone="ghost" disabled={page === 0} onClick={() => turn(page - 1)}>
          ‹ Prev
        </Button>
        <span className="mono sm">
          {page + 1} / {pages}
        </span>
        <Button size="sm" tone="ghost" disabled={page >= pages - 1} onClick={() => turn(page + 1)}>
          Next ›
        </Button>
        {sizes && onPageSize ? (
          <Select
            value={String(pageSize)}
            onChange={(event) => {
              onPageSize(Number(event.target.value));
              scrollToListTop(ref.current);
            }}
            aria-label="Rows per page"
            style={{ width: 110 }}
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Scroll the window so the card holding `from` starts just under the top
 * bar — only when that top is above the fold, so a short list that is
 * already in view does not jump.
 */
export function scrollToListTop(from: HTMLElement | null): void {
  const card = from?.closest<HTMLElement>('.panel') ?? from;
  if (!card || typeof window === 'undefined') return;
  const topbar = document.querySelector<HTMLElement>('.topbar');
  const sticky =
    topbar && ['sticky', 'fixed'].includes(getComputedStyle(topbar).position)
      ? topbar.getBoundingClientRect().height
      : 0;
  const top = card.getBoundingClientRect().top;
  if (top >= sticky) return;
  window.scrollTo({ top: Math.max(0, window.scrollY + top - sticky - 8) });
}
