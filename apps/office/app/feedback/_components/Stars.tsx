'use client';

import { starString, starTone } from '../view-model';

/** A row's stars, coloured by §9.6's bands. */
export function Stars({ rating }: { rating: number }) {
  return (
    <span className={`stars ${starTone(rating)}`} aria-label={`${rating} of 5 stars`}>
      {starString(rating)}
    </span>
  );
}

const FIVE = [1, 2, 3, 4, 5] as const;

/**
 * The star input (§9.6, §9.10). Real radio semantics over five buttons,
 * so arrow keys and a screen reader both know what it is.
 */
export function StarPicker({
  value,
  onChange,
  disabled,
  showCount,
  label = 'Stars',
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** "4 of 5" beside the stars, as the profile's form prints it. */
  showCount?: boolean;
  label?: string;
}) {
  return (
    <div className="starpick" role="radiogroup" aria-label={label}>
      {FIVE.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          className={n <= value ? 'on' : undefined}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          {n <= value ? '★' : '☆'}
        </button>
      ))}
      {showCount && value > 0 ? <span className="count sm muted">{value} of 5</span> : null}
    </div>
  );
}
