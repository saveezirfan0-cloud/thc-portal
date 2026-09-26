'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Chip, Input, InputRow, Pill } from '@thc/ui';
import { EMERGENCY_RELATIONSHIP_SUGGESTIONS, validateEmergencyContact } from '@thc/domain';
import type { EmergencyContactField } from '@thc/domain';
import { clearEmergencyContact, saveEmergencyContact } from '../actions';
import type { EmergencyContact } from '../types';
import { DIAL_CODES, splitE164, toE164 } from './phone';

/**
 * Emergency contact — ADR-0043, `wireframes/staff/request-change.html#emergency`.
 *
 * Optional (Q11): an empty section is a nudge — the amber "Not set" pill
 * here and the subline on the Profile tab — never a lock. Only the office
 * sees it; it is never on the allocation sheet, the timesheet or anything
 * in the Client Portal, and the copy says so, because a worker deciding
 * whether to give a parent's number is entitled to know who reads it.
 *
 * The phone uses the `/apply` picker (dialling code + national number,
 * stored as E.164). `validateEmergencyContact()` is the same check the
 * RPC makes, run first so a typo costs no round trip.
 *
 * `readOnly` is the leaver's view (§10.6 step 7): they can see what the
 * office holds, but nothing is editable.
 */
export function EmergencyContactSection({
  contact,
  readOnly = false,
}: {
  contact: EmergencyContact | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const initial = splitE164(contact?.phone);
  const [name, setName] = useState(contact?.name ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [dialCode, setDialCode] = useState(initial.dialCode);
  const [national, setNational] = useState(initial.national);
  const [errors, setErrors] = useState<Partial<Record<EmergencyContactField, string>>>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    setError(null);
    const phone = national.trim() ? toE164(dialCode, national) : '';
    const check = validateEmergencyContact({ name, relationship, phone });
    if (!check.ok) {
      setErrors({
        ...check.errors,
        // The picker supplies the country code, so "include the area code"
        // is the mistake left to make (the wireframe's wording).
        ...(check.errors.phone && phone
          ? { phone: 'Enter a full phone number, including the area code.' }
          : {}),
      });
      return;
    }
    setErrors({});
    start(async () => {
      const result = await saveEmergencyContact(
        check.value.name,
        check.value.relationship,
        check.value.phone,
      );
      if (!result.ok) setError(result.message);
      else {
        setNote(result.note ?? 'Saved.');
        router.refresh();
      }
    });
  }

  function remove() {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await clearEmergencyContact();
      if (!result.ok) setError(result.message);
      else {
        setName('');
        setRelationship('');
        setNational('');
        setDialCode('+44');
        setNote(result.note ?? 'Removed.');
        router.refresh();
      }
    });
  }

  return (
    <section className="ec-sec" aria-labelledby="ec-title" id="emergency">
      <h3 id="ec-title">Emergency contact {contact ? null : <Pill tone="amber">Not set</Pill>}</h3>
      <p className="xs muted">
        Who should the office call if something happens to you on a shift? Only the office can see
        this — it’s never shared with clients.
      </p>

      <Input
        label="Name"
        value={name}
        autoComplete="off"
        readOnly={readOnly}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />

      <div className="ec-rel">
        <Input
          label="Relationship"
          value={relationship}
          readOnly={readOnly}
          onChange={(event) => setRelationship(event.target.value)}
          error={errors.relationship}
        />
        {readOnly ? null : (
          <div className="ec-suggest" role="group" aria-label="Suggestions">
            {EMERGENCY_RELATIONSHIP_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="ec-chip"
                aria-pressed={relationship === suggestion}
                onClick={() => setRelationship(suggestion)}
              >
                <Chip tone={relationship === suggestion ? 'cyan' : 'neutral'}>{suggestion}</Chip>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <span className="label" id="ec-phone-label">
          Phone
        </span>
        <InputRow>
          <div className="ec-dial">
            <select
              className="input"
              aria-label="Country code"
              value={dialCode}
              disabled={readOnly}
              onChange={(event) => setDialCode(event.target.value)}
            >
              {DIAL_CODES.map((c, i) => (
                <option key={`${c.code}-${i}`} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <input
            className={`input mono${errors.phone ? ' err' : ''}`}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            aria-labelledby="ec-phone-label"
            aria-invalid={errors.phone ? true : undefined}
            placeholder="7700 900123"
            readOnly={readOnly}
            value={national}
            onChange={(event) => setNational(event.target.value)}
          />
        </InputRow>
        {errors.phone ? (
          <span className="error" role="alert">
            {errors.phone}
          </span>
        ) : (
          <span className="hint">Any country — the same picker as your own number.</span>
        )}
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {note ? <Alert tone="green">{note}</Alert> : null}

      {readOnly ? null : (
        <div className="row ec-actions">
          <Button tone="primary" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {contact ? (
            <Button tone="ghost" disabled={pending} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
