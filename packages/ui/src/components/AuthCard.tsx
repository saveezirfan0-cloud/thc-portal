import type { ReactNode } from 'react';

export interface AuthCardProps {
  /** Which app this is, shown under the company name. */
  product: string;
  heading?: string;
  /** Sits above the fields, for the sign-in error (§1.4). */
  banner?: ReactNode;
  /** Small print under the button. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The sign-in card shared by all three apps (§1.4, §10.2).
 *
 * The error copy never says which of email or password was wrong — that is
 * deliberate in the wireframes and is an account-enumeration defence.
 */
export function AuthCard({ product, heading = 'Sign in', banner, footer, children }: AuthCardProps) {
  return (
    <div className="auth-wrap">
      <section className="auth-card">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            THC
          </span>
          <div>
            <div className="name">The Hospitality Company</div>
            <div className="sub">{product}</div>
          </div>
        </div>
        <h2>{heading}</h2>
        {banner}
        {children}
        {footer ? <div className="foot">{footer}</div> : null}
      </section>
    </div>
  );
}
