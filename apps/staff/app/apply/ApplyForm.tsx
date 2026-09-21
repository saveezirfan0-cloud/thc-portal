'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Input, Select } from '@thc/ui';
import { apply } from './actions';
import { AGE_OPTIONS, DIAL_CODES, INITIAL_STATE, errorBanner, validate } from './form';
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

  // Before the first submit the form stays quiet; after it, the field errors
  // follow what the person types. The server's answer seeds the first pass.
  const errors: FieldErrors = touched ? validate(values) : state.errors;
  const banner = errorBanner(errors);

  function set<K extends keyof ApplicationValues>(key: K, value: ApplicationValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // The wireframe shows the button disabled in the under-18 / no-consent
  // state. Nothing is created until the server and the database agree anyway.
  const blocked = values.ageBand === 'under_18' || !values.consent;

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
        <div className="input-row">
          <div style={{ flex: '0 0 118px' }}>
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
        </div>
        {errors.mobile ? (
          <span className="error" role="alert">
            {errors.mobile}
          </span>
        ) : (
          <span className="hint">International picker — number stored in E.164.</span>
        )}
      </div>

      <Select
          label="Age"
          name="ageBand"
          hint="You must be 18 or over to work with us."
          value={values.ageBand}
          onChange={(e) => set('ageBand', e.target.value)}
          error={errors.ageBand}
      >
        <option value="">Select your age</option>
        {AGE_OPTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </Select>

      <label className="check">
        <input
          type="checkbox"
          name="consent"
          className="check-input"
          checked={values.consent}
          onChange={(e) => set('consent', e.target.checked)}
        />
        <span
          className={`box${values.consent ? ' on' : ''}`}
          aria-hidden="true"
          style={errors.consent ? { borderColor: 'var(--coral)' } : undefined}
        />
        <span className="txt">
          I agree to The Hospitality Company storing and processing the details on this form to
          assess my application, as described in the <a href="/privacy">Privacy notice</a>.{' '}
          <span className="muted">(GDPR consent — required)</span>
          {errors.consent ? <span className="error">{errors.consent}</span> : null}
        </span>
      </label>

      <Button type="submit" tone="primary" size="lg" block disabled={pending || blocked}>
        {pending ? 'Sending…' : 'Submit application'}
      </Button>

      <div className="xs muted" style={{ textAlign: 'center' }}>
        Questions? <a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>
      </div>
    </form>
  );
}
