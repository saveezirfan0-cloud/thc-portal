import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** No photo and no initials: a GDPR-removed worker keeps their slot (§1.7). */
  deleted?: boolean;
  /**
   * Without a photo, draw a neutral person glyph instead of initials. The
   * Client Portal shows faces, never initials (§11.1; the wireframes draw a
   * silhouette). Off by default, so every other screen keeps its monogram.
   */
  silhouette?: boolean;
  className?: string;
}

/** A head-and-shoulders glyph in `currentColor`, cropped by the avatar's shape. */
function SilhouetteGlyph() {
  return (
    <svg className="avatar-glyph" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="12" r="6.5" fill="currentColor" />
      <path d="M3 34c0-9 6-13 13-13s13 4 13 13z" fill="currentColor" />
    </svg>
  );
}

/** Initials from a display name: "Amira Khan" → "AK", "Deleted account #41" → "DA". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * The onboarding selfie carries through the whole system: a circle in the
 * product (warm, ADR-0121), square only in the scope §1.6 literal rendering,
 * falling back to monogram initials on the divider colour. The shape is a
 * token (`--r-avatar`), never a prop.
 */
export function Avatar({ name, src, size = 'md', deleted, silhouette, className }: AvatarProps) {
  const glyph = !deleted && !src && silhouette;
  return (
    <span
      className={clsx(
        'avatar',
        size !== 'md' && size,
        deleted && 'deleted',
        glyph && 'silhouette',
        className,
      )}
      title={name}
      // The glyph says nothing on its own, so the slot carries the name.
      {...(glyph ? { role: 'img', 'aria-label': name } : {})}
    >
      {deleted ? null : src ? (
        <img src={src} alt={name} />
      ) : glyph ? (
        <SilhouetteGlyph />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export interface AvatarGroupProps {
  children: ReactNode;
  /**
   * How many people are not drawn. Above zero, a "+N" chip closes the row,
   * the same size and shape as the faces before it (`.avatar.more`).
   */
  more?: number;
  /** The faces' size, so the chip matches them. Defaults to `md`. */
  size?: AvatarProps['size'];
  /** Tooltip and spoken name for the chip. Defaults to "N more". */
  moreLabel?: string;
}

/** Overlapping row of avatars, e.g. a role line-up preview. */
export function AvatarGroup({ children, more, size = 'md', moreLabel }: AvatarGroupProps) {
  const extra = more && more > 0 ? Math.floor(more) : 0;
  const label = moreLabel ?? `${extra} more`;
  return (
    <span className="avatars">
      {children}
      {extra > 0 ? (
        <span
          className={clsx('avatar', size !== 'md' && size, 'more')}
          title={label}
          role="img"
          aria-label={label}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/** Avatar + name + sub-line, the row used across every list of people. */
export function Person({
  name,
  sub,
  src,
  size,
  deleted,
}: Pick<AvatarProps, 'name' | 'src' | 'size' | 'deleted'> & { sub?: ReactNode }) {
  return (
    <span className="person">
      <Avatar name={name} src={src} size={size} deleted={deleted} />
      <span>
        <span className="n">{name}</span>
        {sub ? <span className="s">{sub}</span> : null}
      </span>
    </span>
  );
}
