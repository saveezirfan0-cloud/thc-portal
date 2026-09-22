import type { ReactNode } from 'react';
import { Button } from './Button';
import type { ButtonSize, ButtonTone } from './Button';

export interface SignOutProps {
  /** The sign-out route. All three apps mount it at the same path (§1.4). */
  action?: string;
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Fills the container width — the Staff App's profile sheet wants this. */
  block?: boolean;
  /**
   * Goes on the BUTTON, not the form. The form is `display: contents` and
   * generates no box, so a margin or alignment class on it would do nothing.
   */
  className?: string;
  children?: ReactNode;
}

/**
 * Sign out (§1.4).
 *
 * A form POST, never a link. `/auth/signout` only answers POST, which is
 * deliberate: a GET sign-out fires from anything that can make the browser
 * issue one — a link prefetch, an `<img src>` on a page the worker is
 * reading, a mistyped URL — and logs people out of a shift they are in the
 * middle of. A link here does not merely fail the CSRF test, it returns 405
 * and leaves the button visibly broken.
 *
 * The form is `display: contents`, so it participates in the parent's flex
 * layout as if the button were a direct child. Every placement in the
 * wireframes sits inside a flex row (the client top bar, the Back Office
 * sidebar foot) and a block-level wrapper would break each one.
 */
export function SignOut({
  action = '/auth/signout',
  tone = 'ghost',
  size = 'sm',
  block,
  className,
  children = 'Sign out',
}: SignOutProps) {
  return (
    <form method="post" action={action} className="signout">
      <Button
        type="submit"
        tone={tone}
        size={size}
        {...(block ? { block: true } : {})}
        {...(className ? { className } : {})}
      >
        {children}
      </Button>
    </form>
  );
}
