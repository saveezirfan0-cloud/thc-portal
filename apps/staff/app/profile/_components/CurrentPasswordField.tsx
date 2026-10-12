'use client';

import { Input } from '@thc/ui';

/**
 * "Current password" — the field Security settings has always had
 * (`wireframes/staff/profile.html`, Change password), reused in front of
 * the three other writes a stolen, still-signed-in phone must not make on
 * its own: Bank & payroll, a new email address, and Request my P45
 * (ADR-0113). One field, the same label and autofill hint everywhere, so a
 * password manager offers the saved password in each.
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
      {...(hint ? { hint } : {})}
    />
  );
}
