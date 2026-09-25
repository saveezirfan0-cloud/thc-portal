'use client';

import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

/**
 * A list row that opens the event board wherever it is clicked (§3.1;
 * events.html `<tr class="clickable" onclick="location.href=…">`).
 *
 * The title inside stays a real link, which is the keyboard and
 * middle-click path; this only makes the rest of the row honour the pointer
 * cursor `.tbl tr.clickable` already shows. A click that lands on a link or
 * a button inside the row is left to that control.
 */
export function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, select, label')) return;
    router.push(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') router.push(href);
  };

  return (
    <tr className={className} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </tr>
  );
}
