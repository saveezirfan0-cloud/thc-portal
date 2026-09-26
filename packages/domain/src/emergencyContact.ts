/**
 * Emergency contact — ADR-0044, docs/19 §2 (an addition to Scope v1.6:
 * §1.5 Staff, §9.6, §10.1 Profile details, §1.7 GDPR).
 *
 * One optional contact per worker, in `staff_emergency_contacts`: office-only
 * worker personal data. It is NEVER on a client document — §11.3's
 * allocation sheet and timesheet are the client's — and no `client_*` view
 * reads the table (ADR-0004/0026, pgTAP 700). GDPR removal deletes it.
 *
 * The phone is stored in E.164, the `/apply` rule
 * (`^\+[1-9][0-9]{6,14}$`, `staff_emergency_contacts_phone`). The form's
 * international picker sends `+<country><number>`; what a person types in
 * between — spaces, dashes, brackets — is stripped here before the check,
 * and a number without its country code is refused rather than guessed.
 * emergencyContact.vectors.json holds this and the table's CHECKs to the
 * same cases (Vitest here, pgTAP 700 there).
 */

import { isPhone } from './onboarding';

export const EMERGENCY_CONTACT_NAME_MAX = 100;
export const EMERGENCY_CONTACT_RELATIONSHIP_MAX = 40;

/** What the relationship field suggests; any 1–40 characters is accepted. */
export const EMERGENCY_RELATIONSHIP_SUGGESTIONS = [
  'Parent',
  'Partner',
  'Sibling',
  'Friend',
  'Other',
] as const;

/** E.164, exactly as the table's CHECK and `submit_application()` spell it. */
export const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

/** True when the value may be stored as it is. */
export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/**
 * The value to store for what was typed, or null when it cannot be a phone
 * number we can call. Separators are dropped; the leading `+` and country
 * code are required. `isPhone` (onboarding.ts) is the shared first test —
 * 7 to 15 digits — and E.164 the second.
 */
export function normaliseEmergencyPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('+') || !isPhone(trimmed)) return null;
  const compact = trimmed.replace(/[\s\-()]/g, '');
  return isE164(compact) ? compact : null;
}

/** Characters as Postgres's char_length counts them (code points). */
function chars(value: string): number {
  return Array.from(value).length;
}

export interface EmergencyContactInput {
  name: string;
  relationship: string;
  phone: string;
}

export type EmergencyContactField = keyof EmergencyContactInput;

export type EmergencyContactValidation =
  | { ok: true; value: EmergencyContactInput }
  | { ok: false; errors: Partial<Record<EmergencyContactField, string>> };

/** The form's check, and the values `save_my_emergency_contact` is sent. */
export function validateEmergencyContact(input: EmergencyContactInput): EmergencyContactValidation {
  const name = input.name.trim();
  const relationship = input.relationship.trim();
  const phone = normaliseEmergencyPhone(input.phone);
  const errors: Partial<Record<EmergencyContactField, string>> = {};

  if (!name) errors.name = 'Enter their name.';
  else if (chars(name) > EMERGENCY_CONTACT_NAME_MAX) {
    errors.name = `Keep the name to ${EMERGENCY_CONTACT_NAME_MAX} characters.`;
  }
  if (!relationship) errors.relationship = 'Say who they are to you, for example Parent.';
  else if (chars(relationship) > EMERGENCY_CONTACT_RELATIONSHIP_MAX) {
    errors.relationship = `Keep this to ${EMERGENCY_CONTACT_RELATIONSHIP_MAX} characters.`;
  }
  if (!input.phone.trim()) errors.phone = 'Enter their phone number.';
  else if (phone === null) {
    errors.phone = 'Enter the number with its country code, for example +44 7700 900123.';
  }

  if (Object.keys(errors).length > 0 || phone === null) return { ok: false, errors };
  return { ok: true, value: { name, relationship, phone } };
}
