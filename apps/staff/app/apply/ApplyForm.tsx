'use client';

import { useActionState, useId, useState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { submitApplication } from './actions';
import {
  ageOn,
  emptyDraft,
  EMPTY_APPLY_STATE,
  parseDob,
  PRIVACY_NOTICE_URL,
  MESSAGES,
  summaryMessage,
  validateApplication,
  type ApplicationDraft,
  type ApplicationErrors,
} from './application';
import { COMMON_COUNTRIES, optionLabel, OTHER_COUNTRIES } from './countries';

/**
 * The public application form (§2.1), matching `wireframes/public/apply.html`.
 *
 * Two gates decide when an error is on screen, because the wireframe shows
 * two different behaviours:
 *
 *  - Under 18 is refused "on the spot" — picking it shows the coral error
 *    and disables Submit immediately, before any attempt.
 *  - Everything else (including the mandatory GDPR tick) appears once the
 *    applicant has tried to submit, and then tracks their corrections live.
 *
 * None of this is a security boundary. The server action re-runs exactly
 * the same rules and `submit_application` re-runs the age and consent
 * checks in SQL, which is what §1.7's "on the form and on the backend"
 * actually asks for.
 */
export function ApplyForm() {
  const [state, formAction, pending] = useActionState(submitApplication, EMPTY_APPLY_STATE);
  const [draft, setDraft] = useState<ApplicationDraft>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const consentId = useId();

  const checked = validateApplication(draft);
  const liveErrors: ApplicationErrors = checked.ok ? {} : checked.errors;
  // "On the spot" now means: a complete date that puts them under 18.
  // A half-typed year is not a rejection, it is an unfinished field.
  const parsed = parseDob(draft.dob);
  const underAge = parsed !== null && ageOn(parsed) < 18;

  // Before the first attempt only the age gate speaks. After it, the
  // form's own errors sit on top of whatever the server sent back — the
  // form's are fresher, but a server error the form cannot reproduce (a
  // tampered field, or the database refusing something) has to stay
  // visible rather than vanish on the next keystroke.
  const shown: ApplicationErrors = attempted
    ? { ...state.errors, ...liveErrors }
    : underAge
      ? { dob: MESSAGES.dobUnder18 }
      : {};

  // The banner appears with the age error too, not only after a click:
  // the wireframe's validation state draws the coral banner, the coral
  // age error and a disabled button together, and disabling the button
  // "on the spot" is otherwise what stops that state being reachable.
  const summary =
    (attempted || underAge) && Object.keys(shown).length > 0
      ? summaryMessage(shown)
      : state.summary;
  const blocked = underAge || (attempted && !checked.ok);

  function set<K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        setAttempted(true);
        if (!validateApplication(draft).ok) event.preventDefault();
      }}
      noValidate
      className="apply-form"
    >
      <p className="lead">
        Two minutes. Straight after you submit, you&apos;ll get an email with a link to a short
        video interview.
      </p>

      {summary ? <Alert tone="coral">{summary}</Alert> : null}

      <div className="grid c2">
        <Input
          label="First name"
          name="firstName"
          autoComplete="given-name"
          placeholder="e.g. Amara"
          value={draft.firstName}
          onChange={(e) => set('firstName', e.target.value)}
          error={shown.firstName}
        />
        <Input
          label="Surname"
          name="lastName"
          autoComplete="family-name"
          placeholder="e.g. Kalu"
          value={draft.lastName}
          onChange={(e) => set('lastName', e.target.value)}
          error={shown.lastName}
        />
      </div>

      <Input
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={draft.email}
        onChange={(e) => set('email', e.target.value)}
        hint="Your interview link and everything else lands here."
        error={shown.email}
      />

      {/* The picker and the number are one field with two controls, so the
          label, hint and error belong to the row rather than to either. */}
      <div className="field">
        <span className="label" id="mobile-label">
          Mobile
        </span>
        <div className="input-row">
          <select
            className="input apply-dial"
            name="country"
            aria-label="Country dialling code"
            value={draft.country}
            onChange={(e) => set('country', e.target.value)}
          >
            <optgroup label="Common">
              {COMMON_COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {optionLabel(c)}
                </option>
              ))}
            </optgroup>
            <optgroup label="All countries">
              {OTHER_COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {optionLabel(c)}
                </option>
              ))}
            </optgroup>
          </select>
          <input
            className={`input${shown.mobile ? ' err' : ''}`}
            name="mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="7700 900123"
            aria-labelledby="mobile-label"
            aria-invalid={shown.mobile ? true : undefined}
            value={draft.mobile}
            onChange={(e) => set('mobile', e.target.value)}
          />
        </div>
        {shown.mobile ? (
          <span className="error" role="alert">
            {shown.mobile}
          </span>
        ) : (
          <span className="hint">International picker — number stored in E.164.</span>
        )}
      </div>

      {/* A native date input opens the OS wheel picker on a phone, which is
          where §2.1 says applicants are. No `max`: capping it at today
          minus eighteen years would hide the under-18 case rather than
          refuse it, and the wireframe refuses it out loud. */}
      <Input
        label="Date of birth"
        name="dob"
        type="date"
        autoComplete="bday"
        value={draft.dob}
        onChange={(e) => set('dob', e.target.value)}
        hint="You must be 18 or over to work with us."
        error={shown.dob}
      />

      {/* §1.7: the GDPR tick is mandatory and its timestamp is stored with
          the record. The styled square is the wireframe's; the real
          checkbox behind it is what keyboards and screen readers use. */}
      <div className="field">
        {/* The input is nested, so the label is associated implicitly; an
            htmlFor as well makes some browsers toggle twice. */}
        <label className="check apply-consent">
          <input
            id={consentId}
            type="checkbox"
            name="consent"
            checked={draft.consent}
            onChange={(e) => set('consent', e.target.checked)}
            aria-invalid={shown.consent ? true : undefined}
            aria-describedby={shown.consent ? `${consentId}-error` : undefined}
          />
          <span className={`box${draft.consent ? ' on' : ''}`} aria-hidden="true" />
          <span className="txt">
            I agree to The Hospitality Company storing and processing the details on this form to
            assess my application, as described in the{' '}
            <a href={PRIVACY_NOTICE_URL} target="_blank" rel="noreferrer">
              Privacy notice
            </a>
            . <span className="muted">(GDPR consent — required)</span>
          </span>
        </label>
        {shown.consent ? (
          <span className="error" id={`${consentId}-error`} role="alert">
            {shown.consent}
          </span>
        ) : null}
      </div>

      <Button type="submit" tone="primary" size="lg" block disabled={blocked || pending}>
        {pending ? 'Sending…' : 'Submit application'}
      </Button>
    </form>
  );
}
