import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** No photo and no initials: a GDPR-removed worker keeps their slot (§1.7). */
  deleted?: boolean;
  className?: string;
}

/** Initials from a display name: "Amira Khan" → "AK", "Deleted account #41" → "DA". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * The onboarding selfie carries through the whole system: square in the scope
 * style, circular in warm, falling back to monogram initials on the divider
 * colour. The shape is a token, never a prop.
 */
export function Avatar({ name, src, size = 'md', deleted, className }: AvatarProps) {
  return (
    <span
      className={clsx('avatar', size !== 'md' && size, deleted && 'deleted', className)}
      title={name}
    >
      {deleted ? null : src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}

/** Overlapping row of avatars, e.g. a role line-up preview. */
export function AvatarGroup({ children }: { children: ReactNode }) {
  return <span className="avatars">{children}</span>;
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
