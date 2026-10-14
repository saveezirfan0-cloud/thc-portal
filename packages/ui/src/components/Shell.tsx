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
  /** Gets its own tab in the phone tab bar; the rest sit behind More. */
  primary?: boolean;
  /** The tab-bar label where the full one does not fit, e.g. "Check-in". */
  short?: string;
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

/** Where "Skip to content" lands: the one `<main>` a `Content` draws. */
export const MAIN_ID = 'main';

/**
 * The Back Office frame: sidebar, then the column with the top bar and the
 * page. The first thing a keyboard reaches is "Skip to content" — out of
 * sight until focused — so a manager does not Tab through the whole menu
 * (18 stops, release audit 14.10.2026) on every page to reach its first
 * control (WCAG 2.4.1).
 */
export function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      <a className="skip-link" href={`#${MAIN_ID}`}>
        Skip to content
      </a>
      {sidebar}
      <div className="main">{children}</div>
    </div>
  );
}

/**
 * The page's content well, and its `<main>` landmark — one per page. It
 * takes focus from the skip link (`tabIndex={-1}`), so the next Tab starts
 * inside the page rather than back at the top of the menu.
 */
export function Content({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className={clsx('content', className)}>
      {children}
    </main>
  );
}

/** The signed-in user, right-aligned in the top bar: avatar + name. */
export function UserChip({ children }: { children: ReactNode }) {
  return <span className="userchip">{children}</span>;
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
