'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input } from '@thc/ui';
import { addressErrors, formatPostcode, pinInUk } from '@thc/domain';
import { lookupPostcode, saveAddress } from '../actions';
import { DEFAULT_CENTRE } from '../geo';
import type { LatLng } from '../geo';
import { PinMap } from './PinMap';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 2/11 Home address — a pin on the map (§10.3), wireframes/staff/onboarding-1.html.
 *
 * The pin is the point of the step: "needed to calculate the home ↔ venue
 * distance" — §6 proximity and Radar's distances. The lines are what the
 * office and payroll read. The postcode search only moves the map.
 *
 * The postcode is also stored on its own, formatted, and the country as
 * United Kingdom (onboarding_save_address, 20260926100300) — the §9.9 New
 * Starter report's Postcode and Country columns. There is no country field
 * because the step refuses a non-UK postcode and a pin outside the UK.
 */
export function AddressStep({
  initial,
}: {
  initial: { line: string; town: string; postcode: string; lat: number | null; lng: number | null };
}) {
  const router = useRouter();
  const [line, setLine] = useState(initial.line);
  const [town, setTown] = useState(initial.town);
  const [postcode, setPostcode] = useState(initial.postcode);
  const [pin, setPin] = useState<LatLng | null>(
    initial.lat !== null && initial.lng !== null ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [pending, start] = useTransition();

  const errors = addressErrors({
    line,
    town,
    postcode,
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
  });
  const missing = Object.values(errors)[0] ?? null;

  function locate() {
    setNote(null);
    if (!navigator.geolocation) {
      setNote('Location isn’t available on this device — search your postcode or move the map.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!pinInUk(p.lat, p.lng))
          setNote('You seem to be outside the UK — move the pin to your home.');
        setPin(p);
      },
      () => {
        setLocating(false);
        setNote('We couldn’t get your location — search your postcode or move the map.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function findPostcode() {
    setNote(null);
    start(async () => {
      const found = await lookupPostcode(postcode);
      if (!found.ok) setNote(found.message);
      else {
        setPin({ lat: found.lat, lng: found.lng });
        setPostcode(formatPostcode(postcode));
      }
    });
  }

  function next() {
    if (!pin) return;
    setError(null);
    start(async () => {
      const result = await saveAddress({ line, town, postcode, lat: pin.lat, lng: pin.lng });
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/3');
    });
  }

  return (
    <>
      <WizardTop
        step={2}
        heading="Where do you live?"
        sub="We use it to work out how far each venue is from you — closer shifts rank higher (§6) and Radar shows distances from here."
      />

      <div className="row">
        <div className="grow">
          <Input
            aria-label="Postcode search"
            placeholder="Your postcode, e.g. E2 0RY"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </div>
        <Button onClick={findPostcode} disabled={pending || postcode.trim() === ''}>
          Find
        </Button>
      </div>

      <PinMap
        centre={pin ?? DEFAULT_CENTRE}
        onMove={setPin}
        onLocate={locate}
        locating={locating}
      />
      {note ? <Alert tone="amber">{note}</Alert> : null}

      <Input
        label="Address line"
        value={line}
        onChange={(e) => setLine(e.target.value)}
        autoComplete="address-line1"
      />
      <div className="row">
        <div className="grow">
          <Input
            label="Town / city"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            autoComplete="address-level2"
          />
        </div>
        <div className="postcode-field">
          <Input
            label="Postcode"
            mono
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            onBlur={() => setPostcode((p) => formatPostcode(p))}
            autoComplete="postal-code"
          />
        </div>
      </div>
      <div className="xs muted">
        You can change your address later in Profile details — the office is notified of the change
        (E7).
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <WizardFoot
        hint={
          missing && pin === null ? 'Drop the pin on your home to continue' : (missing ?? undefined)
        }
      >
        <Button
          tone="primary"
          size="lg"
          block
          disabled={Boolean(missing) || pending}
          onClick={next}
        >
          {pending ? 'Saving…' : 'Continue'}
        </Button>
      </WizardFoot>
    </>
  );
}
