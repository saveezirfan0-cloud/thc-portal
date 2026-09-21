import { clsx } from 'clsx';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Initials from a display name: "Amira Khan" → "AK", "Deleted account #41" → "DA". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <span className={clsx('avatar', size !== 'md' && size, className)} title={name}>
      {src ? <img src={src} alt={name} width="100%" height="100%" /> : initials(name)}
    </span>
  );
}
