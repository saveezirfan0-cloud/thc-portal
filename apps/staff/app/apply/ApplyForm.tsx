'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputRow } from '@thc/ui';
import { apply } from './actions';
import {
  COMMON_COUNTRIES,
  INITIAL_STATE,
  OTHER_COUNTRIES,
  ageOn,
  countryLabel,
  errorBanner,
  parseDob,
  validate,
  visibleErrors,
} from './form';
import type { ApplicationValues, FieldErrors } from './form';

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
  // follow what the person types — plus whatever the server refused that
  // the person has not changed since (visibleErrors), so a refusal only the
  // server could make is never dropped on the floor. The server's answer
  // seeds the first pass.
  const checked = validate(values);
  const errors: FieldErrors = touched ? visibleErrors(checked, state, values) : { ...state.errors };

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
          {/* The wireframe's `.caret` wrapper: the mark is a pseudo-element
              in the muted token, so it follows the theme — a select cannot
              carry a pseudo-element of its own. ADR-0009: the value is the
              ISO code, the two groups are disjoint, the list is every
              country and the browser's type-ahead finds one by name. */}
          <div className="caret apply-dial">
            <select
              className="input"
              name="country"
              aria-label="Country code"
              value={values.country}
              onChange={(e) => set('country', e.target.value)}
            >
              <optgroup label="Common">
                {COMMON_COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {countryLabel(c)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All countries">
                {OTHER_COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {countryLabel(c)}
                  </option>
                ))}
              </optgroup>
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
        {errors.mobile ? (
          <span className="error" role="alert">
            {errors.mobile}
          </span>
        ) : (
          <span className="hint">International picker — number stored in E.164.</span>
        )}
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
        The shared Checkbox (D1): a real, focusable input under the drawn
        square, so Tab and Space work and the accessible name is the
        browser's. The one thing it has no prop for is the coral box border
        the wireframe draws when the GDPR consent is missing (§1.7), so that
        state is a class on the wrapper and one rule in apply.css rather
        than a second copy of the control.
      */}
      <div className={errors.consent ? 'consent-missing' : undefined}>
        <Checkbox
          name="consent"
          checked={values.consent}
          onChange={(checked) => {
            setConsentTouched(true);
            set('consent', checked);
          }}
          error={errors.consent}
        >
          I agree to The Hospitality Company storing and processing the details on this form to
          assess my application, as described in the <a href="/privacy">Privacy notice</a>.{' '}
          <span className="muted">(GDPR consent — required)</span>
        </Checkbox>
      </div>

      <Button type="submit" tone="primary" size="lg" block disabled={pending || blocked}>
        {pending ? 'Sending…' : 'Submit application'}
      </Button>

      <div className="xs muted" style={{ textAlign: 'center' }}>
        Questions?{' '}
        <a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>
      </div>
    </form>
  );
}
