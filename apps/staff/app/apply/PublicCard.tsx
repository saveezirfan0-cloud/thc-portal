import type { ReactNode } from 'react';
import { Logo } from '@thc/ui';

export interface PublicCardProps {
  /** Shown under the company name — "Join our team" on both /apply screens. */
  product: string;
  /** Extra class on the card: `done` for the confirmation state. */
  className?: string;
  children: ReactNode;
}

/**
 * The public card both /apply screens sit in (§2.1, §2.7) —
 * `wireframes/public/apply.html`, every state.
 *
 * Not the shared `AuthCard`, and deliberately so: that card always draws
 * the appearance switch in its corner, because sign-in has no chrome to
 * carry it and the app that follows must match the device (ADR-0007). No
 * app follows an application. The wireframe draws no switch on this card
 * in any of its three states, and until this component the form showed one
 * while "Check your inbox" did not — two screens of one flow disagreeing
 * with each other and with the drawing. The page follows the device's own
 * preference instead, which is what a public page with no session does.
 *
 * Same `.auth-wrap` / `.auth-card` / `.brand` markup as `AuthCard`, so the
 * design system's card styling applies unchanged and `apply.css` only has
 * to left-align the brand row as the wireframe does.
 */
export function PublicCard({ product, className, children }: PublicCardProps) {
  return (
    <div className="auth-wrap">
      <section className={className ? `auth-card ${className}` : 'auth-card'}>
        <div className="brand">
          <Logo size="lg" />
          <div>
            <div className="name">The Hospitality Company</div>
            <div className="sub">{product}</div>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
