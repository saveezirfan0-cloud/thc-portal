'use client';

import Link from 'next/link';
import { Input } from '@thc/ui';

/**
 * "Current password" — the field Security settings has always had
 * (`wireframes/staff/profile.html`, Change password), reused in front of
 * the three other writes a stolen, still-signed-in phone must not make on
 * its own: Bank & payroll, a new email address, and Request my P45
 * (ADR-0113). One field, the same label and autofill hint everywhere, so a
 * password manager offers the saved password in each.
 *
 * "Forgot password?" sits on the label's line, as it does beside Password on
 * the sign-in screens. Without it a worker who has forgotten the password
 * is stuck on the wizard's step 9 with no way on but signing out (ADR-0113
 * says "uses Forgot password first"; this is where they find it). The reset
 * link signs them in with a `recovery` session, so the screen they return
 * to accepts the new password.
 */
export function CurrentPasswordField({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  return (
    <Input
      label="Current password"
      type="password"
      autoComplete="current-password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      labelAction={
        <Link href="/forgot" className="xs">
          Forgot password?
        </Link>
      }
      {...(hint ? { hint } : {})}
    />
  );
}
