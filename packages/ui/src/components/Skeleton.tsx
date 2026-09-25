import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

export type SkeletonShape = 'line' | 'block' | 'pill' | 'avatar' | 'tile' | 'card';

export interface SkeletonProps {
  /** Any CSS length; a number is pixels. Lines default to the full width. */
  width?: number | string;
  /** Any CSS length; each shape has its own default height. */
  height?: number | string;
  /**
   * The radius family, which is what makes a placeholder read as the thing
   * it stands in for: a text line, a button (pill), a face (avatar), a KPI
   * tile or a whole card. Every radius is a token.
   */
  shape?: SkeletonShape;
  className?: string;
}

/**
 * A placeholder in the shape of content that is still on its way. Purely
 * decorative (`aria-hidden`): the region that holds it — `SkeletonScreen` —
 * is what tells assistive technology the page is loading.
 *
 * The shimmer stops for anyone who asks the OS for reduced motion.
 */
export function Skeleton({ width, height, shape = 'line', className }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <span aria-hidden="true" className={clsx('skel', shape, className)} style={style} />;
}

/** A paragraph of lines, the last one short, as text reads. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={clsx('skel-text', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 && lines > 1 ? '62%' : undefined} />
      ))}
    </span>
  );
}

/** A row of KPI tiles, as the dashboard, reports and profiles open with. */
export function SkeletonKpis({ count = 4 }: { count?: 2 | 3 | 4 | 5 | 6 }) {
  return (
    <div className={clsx('grid', `c${count}`)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} shape="tile" />
      ))}
    </div>
  );
}

/** A filter row: a search and a couple of controls. */
export function SkeletonToolbar({ controls = 2 }: { controls?: number }) {
  return (
    <div className="toolbar">
      <Skeleton shape="block" width="min(100%, 280px)" />
      {Array.from({ length: controls }, (_, index) => (
        <Skeleton key={index} shape="pill" width={120} />
      ))}
    </div>
  );
}

/**
 * A panel with a header and a list of rows — the shape of nearly every Back
 * Office list. `avatar` leads each row with a face, as people lists do.
 */
export function SkeletonPanel({
  rows = 5,
  avatar = false,
  lines = 2,
}: {
  rows?: number;
  avatar?: boolean;
  lines?: number;
}) {
  return (
    <section className="panel" aria-hidden="true">
      <div className="panel-h">
        <Skeleton width="38%" height="1.1em" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skel-row" key={index}>
          {avatar ? <Skeleton shape="avatar" /> : null}
          <SkeletonText lines={lines} />
        </div>
      ))}
    </section>
  );
}

/**
 * The loading state of a whole screen or a panel: announced once as busy,
 * with the placeholders inside it hidden from the accessibility tree.
 */
export function SkeletonScreen({
  label = 'Loading',
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={clsx('skel-screen', className)}
    >
      <span className="skel-label">{label}…</span>
      {children}
    </div>
  );
}
