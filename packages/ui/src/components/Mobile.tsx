import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Staff App chrome. These components are only used by apps/staff. */

export interface AppHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}

export function AppHeader({ title, sub, actions }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <div className="title">{title}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions}
    </header>
  );
}

export function AppBody({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={clsx('app-body', className)}>{children}</main>;
}

export interface BottomNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function BottomNav({
  items,
  activeHref,
  renderLink,
}: {
  items: BottomNavItem[];
  activeHref?: string;
  renderLink?: (item: BottomNavItem, className: string, children: ReactNode) => ReactNode;
}) {
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const className = clsx(item.href === activeHref && 'active');
        const body = (
          <>
            {item.icon ? <span className="ico">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.count ? <span className="n">{item.count}</span> : null}
          </>
        );
        return renderLink ? (
          <span key={item.href}>{renderLink(item, className, body)}</span>
        ) : (
          <a key={item.href} href={item.href} className={className}>
            {body}
          </a>
        );
      })}
    </nav>
  );
}

export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <span className="grab" />
        {children}
      </div>
    </>
  );
}

export interface MobileCardProps {
  title?: ReactNode;
  meta?: ReactNode;
  tone?: string;
  children?: ReactNode;
}

export function MobileCard({ title, meta, tone, children }: MobileCardProps) {
  return (
    <div className={clsx('mcard', tone)}>
      {title ? <div className="t">{title}</div> : null}
      {meta ? <div className="m">{meta}</div> : null}
      {children}
    </div>
  );
}
