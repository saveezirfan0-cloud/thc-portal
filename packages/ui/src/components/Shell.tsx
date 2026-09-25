import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface NavItem {
  href: string;
  label: string;
  /** Right-aligned count badge, e.g. Onboarding's active candidates. */
  count?: number;
  /** Paints the count badge danger, as Compliance's blocked-worker count is. */
  alert?: boolean;
  icon?: ReactNode;
  /** Renders a rule above this item. */
  dividerBefore?: boolean;
  /**
   * The route does not exist yet. Renders as text rather than a link, so a
   * Phase 0 shell shows the shape of the product without handing anyone a
   * 404 from its own sidebar.
   */
  pending?: boolean;
}

export interface SidebarProps {
  items: NavItem[];
  activeHref?: string;
  brand?: ReactNode;
  footer?: ReactNode;
  /** Renders each item; apps pass their router's Link. */
  renderLink?: (item: NavItem, className: string, children: ReactNode) => ReactNode;
  /** For the phone drawer: `aria-controls` on the menu button points here. */
  id?: string;
  /** `open` slides the phone drawer in (below 760px). */
  className?: string;
}

export function Sidebar({
  items,
  activeHref,
  brand,
  footer,
  renderLink,
  id,
  className,
}: SidebarProps) {
  return (
    <aside className={clsx('sidebar', className)} id={id}>
      {brand ? <div className="brand">{brand}</div> : null}
      <nav>
        {items.map((item) => {
          const className = clsx(item.href === activeHref && 'active', item.pending && 'pending');
          const body = (
            <>
              {item.icon ? <span className="ico">{item.icon}</span> : null}
              <span>{item.label}</span>
              {item.count ? (
                <span className={clsx('count', item.alert && 'alert')}>{item.count}</span>
              ) : null}
              {item.pending ? <span className="soon">soon</span> : null}
            </>
          );
          return (
            <span key={item.href}>
              {item.dividerBefore ? <span className="divider" /> : null}
              {item.pending ? (
                <span className={className} aria-disabled="true">
                  {body}
                </span>
              ) : renderLink ? (
                renderLink(item, className, body)
              ) : (
                <a href={item.href} className={className}>
                  {body}
                </a>
              )}
            </span>
          );
        })}
      </nav>
      {footer ? <div className="foot">{footer}</div> : null}
    </aside>
  );
}

export interface TopbarProps {
  title?: ReactNode;
  crumbs?: ReactNode;
  /** Right-hand time-zone note, e.g. "All times UK (Europe/London)". */
  timezone?: ReactNode;
  actions?: ReactNode;
  /** Before the title — the phone menu button. */
  lead?: ReactNode;
}

export function Topbar({ title, crumbs, timezone, actions, lead }: TopbarProps) {
  return (
    <header className="topbar">
      {lead}
      {title ? <h1>{title}</h1> : null}
      {crumbs ? <div className="crumbs">{crumbs}</div> : null}
      <div className="spacer" />
      {timezone ? <span className="tz">{timezone}</span> : null}
      {actions}
    </header>
  );
}

export function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      {sidebar}
      <div className="main">{children}</div>
    </div>
  );
}

export function Content({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('content', className)}>{children}</div>;
}

/** The signed-in user, right-aligned in the top bar: avatar + name. */
export function UserChip({ children }: { children: ReactNode }) {
  return <span className="userchip">{children}</span>;
}

/** Wraps a wide table so it scrolls rather than squashing on a phone (§1.2). */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="table-scroll">{children}</div>;
}

export interface PageHeadProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHead({ title, description, actions }: PageHeadProps) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}
