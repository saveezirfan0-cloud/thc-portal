import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type MetricTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger';

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  /** One-line explanation under the number. */
  description?: ReactNode;
  tone?: MetricTone;
  /** No card chrome: the tile is already inside a panel. */
  flat?: boolean;
  /** Smaller value, for the financial snapshot tiles. */
  small?: boolean;
}

/**
 * The dashboard KPI tile (§9.1): label, colour-coded number, one-line
 * description. The colour carries meaning — amber is "sold but not staffed",
 * danger is a compliance block — so the tone is never decorative.
 */
export function KpiTile({ label, value, description, tone = 'default', flat, small }: KpiTileProps) {
  return (
    <div className={clsx('kpi', tone !== 'default' && tone, flat && 'flat', small && 'sm')}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {description ? <span className="d">{description}</span> : null}
    </div>
  );
}

export interface Stat {
  label: ReactNode;
  value: ReactNode;
}

/** The 3-up stat strip between two rules on a shift card (§10.4). */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="mstats">
      {stats.map((stat, index) => (
        <div key={index}>
          <div className="k">{stat.label}</div>
          <div className="v">{stat.value}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Auto-assign match score (§3.4): a 6px track plus the 0–100 number. Wave-2
 * rows draw the bar grey so the ranking still reads correctly at a glance —
 * a wave-2 worker scoring 94 is invited only after every wave-1 one (RULE-17).
 */
export function Score({ value, wave2 }: { value: number; wave2?: boolean }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <span className={clsx('score', wave2 && 'wave2')}>
      <span className="bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      {Math.round(value)}
    </span>
  );
}

/** Rating colour coding (§9.6): 0–2.9 danger · 3.0–3.9 warning · 4.0+ success. */
export function ratingTone(value: number): 'coral' | 'amber' | 'green' {
  if (value < 3) return 'coral';
  if (value < 4) return 'amber';
  return 'green';
}

export function Rating({ value }: { value: number }) {
  return (
    <span className={clsx('rating', ratingTone(value))}>
      <span className="stars" aria-hidden="true">
        ★
      </span>
      {value.toFixed(1)}
    </span>
  );
}

export type SegState = 'empty' | 'pending' | 'ok';

/** Document progress as a segmented bar: verified / pending / empty (§2.2). */
export function SegBar({ segments }: { segments: SegState[] }) {
  return (
    <span className="segbar">
      {segments.map((state, index) => (
        <i key={index} className={state === 'empty' ? undefined : state} />
      ))}
    </span>
  );
}
