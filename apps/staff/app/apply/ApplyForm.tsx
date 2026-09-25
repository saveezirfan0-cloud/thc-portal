'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputRow } from '@thc/ui';
import { apply } from './actions';
import { DIAL_CODES, INITIAL_STATE, ageOn, errorBanner, parseDob, validate } from './form';
import type { ApplicationField, ApplicationValues, FieldErrors } from './form';

/**
 * The public application form (§2.1), matching
 * `wireframes/public/apply.html`: errors in coral under the field, a banner
 * counting them, and the submit button disabled until the two rules the
 * wireframe shows disabled — 18 or over, and consent — are both satisfied.
 */
export function ApplyForm() {
  const [state, formAction, pending] = useActionState(apply, INITIAL_STATE);
  const [values, setValues] = useState<ApplicationValues>(state.values);
  const [touched, setTouched] = useState(false);
  const [consentTouched, setConsentTouched] = useState(false);

  function set<K extends keyof ApplicationValues>(key: K, value: ApplicationValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // The wireframe shows the button disabled in the under-18 / no-consent
  // state. Nothing is created until the server and the database agree anyway.
  // "On the spot" (§2.1) now means a complete date that puts them under 18.
  // A half-typed year is an unfinished field, not a rejection.
  const dob = parseDob(values.dob);
  const underage = dob !== null && ageOn(dob) < 18;
  const blocked = underage || !values.consent;

  // Before the first submit the form stays quiet; after it, the field errors
  // follow what the person types. The server's answer seeds the first pass.
  const checked = validate(values);
  const errors: FieldErrors = { ...(touched ? checked : state.errors) };

  // A refusal only the server made must not vanish behind a client that
  // thinks the field is fine: it stays while the value it judged is
  // unchanged. Otherwise a submit the server refused would render nothing —
  // no banner, no redirect — and read as a dead button.
  if (touched) {
    for (const [field, message] of Object.entries(state.errors) as [ApplicationField, string][]) {
      if (!errors[field] && values[field] === state.values[field]) errors[field] = message;
    }
  }

  // ...except for the two fields that hold the button down. `blocked`
  // disables submit, so in exactly those states the first submit never
  // happens and a submit-gated error never renders: the button silently goes
  // dead and nothing says why. The wireframe draws the opposite — "under 18
  // is rejected on the spot, coral error on the form" (§2.1) — so these two
  // explain themselves as soon as they are the reason it is dead. Consent
  // waits for the person to have touched it, so a form nobody has filled in
  // yet is not already telling them off.
  if (underage) errors.dob = checked.dob;
  if (consentTouched && !values.consent) errors.consent = checked.consent;

  const banner = errorBanner(errors);

  return (
    <form
      action={formAction}
      onSubmit={() => setTouched(true)}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      noValidate
    >
      <p className="lead">
        Two minutes. Straight after you submit, you&apos;ll get an email with a link to a short
        video interview.
      </p>

      {state.failure ? <Alert tone="coral">{state.failure}</Alert> : null}
      {banner ? <Alert tone="coral">{banner}</Alert> : null}

      <div className="grid c2">
        <Input
          label="First name"
          name="firstName"
          placeholder="e.g. Amara"
          autoComplete="given-name"
          value={values.firstName}
          onChange={(e) => set('firstName', e.target.value)}
          error={errors.firstName}
        />
        <Input
          label="Surname"
          name="lastName"
          placeholder="e.g. Kalu"
          autoComplete="family-name"
          value={values.lastName}
          onChange={(e) => set('lastName', e.target.value)}
          error={errors.lastName}
        />
      </div>

      <Input
        label="Email"
        name="email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        hint="Your interview link and everything else lands here."
        value={values.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
      />

      <div className="field">
        <span className="label" id="mobile-label">
          Mobile
        </span>
        <InputRow>
          {/* `.caret` draws the wireframe's ▾ from a token (apply.css). */}
          <div className="caret" style={{ flex: '0 0 118px' }}>
            <select
              className="input"
              name="dialCode"
              aria-label="Country code"
              value={values.dialCode}
              onChange={(e) => set('dialCode', e.target.value)}
            >
              {DIAL_CODES.map((c, i) => (
                <option key={`${c.code}-${i}`} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <input
            className={`input${errors.mobile ? ' err' : ''}`}
            name="mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            aria-labelledby="mobile-label"
            aria-invalid={errors.mobile ? true : undefined}
            placeholder="7700 900123"
            style={{ borderLeft: 0 }}
            value={values.mobile}
            onChange={(e) => set('mobile', e.target.value)}
          />
        </InputRow>
        {/* The wireframe's "International picker — number stored in E.164"
            is a note to the builder, not to the applicant (docs/15). */}
        {errors.mobile ? (
          <span className="error" role="alert">
            {errors.mobile}
          </span>
        ) : null}
      </div>

      {/* A native date input opens the OS wheel picker on the phone browsers
          §2.1 says applicants use. No `max`: capping it at today minus
          eighteen years hides the under-18 case instead of refusing it, and
          both §1.7 and the wireframe refuse it out loud. */}
      <Input
        label="Date of birth"
        name="dob"
        type="date"
        autoComplete="bday"
        hint="You must be 18 or over to work with us."
        value={values.dob}
        onChange={(e) => set('dob', e.target.value)}
        error={errors.dob}
      />

      {/*
        The shared tick from @thc/ui: a real, focusable input under the drawn
        square (D1), so Space toggles it and it has an accessible name. No
        `value`, so the browser submits "on" — what `read()` in actions.ts
        checks. The coral square of the wireframe's validation state is drawn
        by apply.css from the error this renders, so the two cannot disagree.
      */}
      <div className="apply-consent">
        <Checkbox
          name="consent"
          checked={values.consent}
          onChange={(next) => {
            setConsentTouched(true);
            set('consent', next);
          }}
          error={errors.consent}
        >
          I agree to The Hospitality Company storing and processing the details on this form to
          assess my application, as described in the <a href="/privacy">Privacy notice</a>.{' '}
          <span className="muted">(GDPR consent — required)</span>
        </Checkbox>
      </div>

      {/* Sticky at phone width (apply.css): "full-width and sticky-bottom
          in product" — the fields scroll under it. */}
      <div className="apply-submit">
        <Button type="submit" tone="primary" size="lg" block disabled={pending || blocked}>
          {pending ? 'Sending…' : 'Submit application'}
        </Button>
      </div>

      <div className="xs muted" style={{ textAlign: 'center' }}>
        Questions?{' '}
        <a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>
      </div>
    </form>
  );
}
