'use client';

import { clsx } from 'clsx';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export interface TableScrollProps {
  children: ReactNode;
  /**
   * Names the table for a screen reader ("Venues"). When the table is wider
   * than its card the frame becomes a focusable region with this name, so
   * the arrow keys scroll it.
   */
  label?: string;
  /**
   * The narrowest the table may get before it scrolls sideways instead of
   * squeezing its columns, e.g. `"52rem"`. Defaults to 36rem.
   */
  minWidth?: string;
  /**
   * Column widths come from the header's width hints (`.col-xs` … `.col-xl`),
   * not from the rows, so they hold still while a search narrows the list.
   * Columns without a hint share what is left.
   */
  fixed?: boolean;
  /**
   * How many leading columns stay put while the table scrolls sideways:
   * 1 (the default), or 2 where the first is a lead cell — a tick box or an
   * avatar — and the second is the name.
   */
  pin?: 1 | 2;
  className?: string;
}

/**
 * The one table frame (ADR-0136). The page is the scroller, never the card:
 *
 * - the header row sticks under the top bar while the page scrolls;
 * - a table wider than its card scrolls sideways inside it, with its first
 *   column pinned, a row's actions (`.cell-actions`) pinned to the right
 *   edge, a fade on the side that has more, and a scrollbar that sticks to
 *   the bottom of the window so it is reachable without scrolling to the
 *   last row.
 *
 * Without JavaScript it is a plain sideways scroller, as before. The script
 * only measures: it never moves focus or changes what the table shows.
 */
export function TableScroll({
  children,
  label,
  minWidth,
  fixed,
  pin = 1,
  className,
}: TableScrollProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    const bar = barRef.current;
    if (!frame || !scroller || !bar) return;
    const spacer = bar.firstElementChild as HTMLElement | null;
    // The twin is a pointer control only: the scroller itself takes the
    // keyboard. A browser that makes every scroller focusable would
    // otherwise put a hidden, unnamed stop in the tab order.
    bar.tabIndex = -1;
    let stickTop = 0;
    let frameId = 0;

    const overflowing = () => frame.hasAttribute('data-overflow');

    // The top bar is sticky above the phone break and static below it; the
    // header sticks under it, so its height is the offset.
    const measureTop = () => {
      const topbar = document.querySelector<HTMLElement>('.topbar');
      if (!topbar) return 0;
      const position = getComputedStyle(topbar).position;
      return position === 'sticky' || position === 'fixed'
        ? Math.round(topbar.getBoundingClientRect().height)
        : 0;
    };

    const pinnedWidth = (selector: string) => {
      const cell = scroller.querySelector<HTMLElement>(selector);
      return cell ? cell.getBoundingClientRect().width : 0;
    };
    const pinTwo = frame.classList.contains('pin-2');

    const edges = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      const over = max > 1;
      frame.toggleAttribute('data-overflow', over);
      frame.toggleAttribute('data-fit', !over);
      frame.toggleAttribute('data-more-start', over && scroller.scrollLeft > 1);
      frame.toggleAttribute('data-more-end', over && scroller.scrollLeft < max - 1);
      if (over) {
        scroller.tabIndex = 0;
        if (spacer) spacer.style.width = `${scroller.scrollWidth}px`;
        const lead = pinnedWidth('tr > :first-child');
        const second = pinTwo ? pinnedWidth('tr > :nth-child(2)') : 0;
        frame.style.setProperty('--pin-lead', `${lead}px`);
        frame.style.setProperty('--pin-start', `${lead + second}px`);
        // A row's actions may be two cells (a switch, then a button): both
        // stay at the right edge, the second-to-last inside the last.
        const last = pinnedWidth('tr > .cell-actions:last-child');
        const before = pinnedWidth('tr > .cell-actions:nth-last-child(2):has(+ .cell-actions)');
        frame.style.setProperty('--pin-end-1', `${last}px`);
        frame.style.setProperty('--pin-end', `${last + before}px`);
      } else {
        scroller.removeAttribute('tabindex');
      }
      if (bar.scrollLeft !== scroller.scrollLeft) bar.scrollLeft = scroller.scrollLeft;
    };

    // A sideways scroller is a scroll container in both axes, so a sticky
    // header inside it sticks to it, not to the page. While the table
    // overflows, the header is moved down by hand to where the page's
    // sticky line is, never past the table's last row.
    const head = () => {
      const table = scroller.querySelector('table');
      const thead = table?.tHead;
      if (!overflowing() || !thead) {
        frame.style.removeProperty('--thead-shift');
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const max = Math.max(0, rect.height - thead.getBoundingClientRect().height);
      const shift = Math.max(0, Math.min(stickTop - rect.top, max));
      frame.style.setProperty('--thead-shift', `${Math.round(shift)}px`);
    };

    const measure = () => {
      stickTop = measureTop();
      frame.style.setProperty('--tbl-top', `${stickTop}px`);
      edges();
      head();
    };

    const onPageScroll = () => {
      if (!overflowing() || frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        head();
      });
    };
    const onScroll = () => edges();
    const onBar = () => {
      if (scroller.scrollLeft !== bar.scrollLeft) scroller.scrollLeft = bar.scrollLeft;
    };

    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    bar.addEventListener('scroll', onBar, { passive: true });
    window.addEventListener('scroll', onPageScroll, { passive: true });
    window.addEventListener('resize', measure);

    // The table is re-measured whenever it changes size — a search narrows
    // it, a page of rows replaces it — and whenever the top bar does.
    let observer: ResizeObserver | undefined;
    let watched: Element | null = null;
    const watchTable = () => {
      const table = scroller.querySelector('table');
      if (!observer || table === watched) return;
      if (watched) observer.unobserve(watched);
      if (table) observer.observe(table);
      watched = table;
    };
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure());
      observer.observe(scroller);
      const topbar = document.querySelector('.topbar');
      if (topbar) observer.observe(topbar);
      watchTable();
    }
    const mutations =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            watchTable();
            measure();
          })
        : undefined;
    mutations?.observe(scroller, { childList: true });

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      bar.removeEventListener('scroll', onBar);
      window.removeEventListener('scroll', onPageScroll);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
      mutations?.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, []);

  const style = minWidth ? ({ '--tbl-min': minWidth } as CSSProperties) : undefined;

  return (
    <div
      ref={frameRef}
      className={clsx('tbl-frame', fixed && 'fixed', pin === 2 && 'pin-2', className)}
      style={style}
    >
      <div
        ref={scrollRef}
        className="tbl-scroll"
        role={label ? 'region' : undefined}
        aria-label={label}
      >
        {children}
      </div>
      <div ref={barRef} className="tbl-hbar" aria-hidden="true">
        <div />
      </div>
    </div>
  );
}
