'use client';

/**
 * The auto-assign switch (§3.4) — purple, default ON, at event and role level.
 *
 * It reads the `.switch` classes already in `packages/ui`, so it inherits the
 * design system's tokens without adding a component to the shared package.
 * A real checkbox underneath keeps it operable by keyboard and screen reader;
 * the track is the painted part.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch purple${checked ? ' on' : ''}`}>
      <input
        type="checkbox"
        className="sb-sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track" aria-hidden="true" />
      {label}
    </label>
  );
}
