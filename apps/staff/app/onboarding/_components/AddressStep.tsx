'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input } from '@thc/ui';
import { addressErrors, formatPostcode, pinInUk } from '@thc/domain';
import { AddressFields } from '../../_components/AddressFields';
import { addressLine, homeAddressMissing } from '../../_lib/address';
import type { HomeAddressParts } from '../../_lib/address';
import { lookupPostcode, saveAddress, saveLanguages } from '../actions';
import { DEFAULT_CENTRE } from '../geo';
import type { LatLng } from '../geo';
import { LanguagesQuestion } from './LanguagesQuestion';
import { PinMap } from './PinMap';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 2/11 Home address — a pin on the map (§10.3), wireframes/staff/onboarding-1.html.
 *
 * The pin is the point of the step: "needed to calculate the home ↔ venue
 * distance" — §6 proximity and Radar's distances. The lines are what the
 * office and payroll read: one box per part (flat, house, street, area,
 * town, postcode), sent to the RPC as its `line, town, postcode`. The
 * postcode search only moves the map, and fills the Postcode box.
 *
 * It also asks which languages the worker speaks (ADR-0080): an event can
 * need staff who speak more than English, and only those who said so are
 * offered it.
 */
export function AddressStep({
  initial,
  languages: initialLanguages,
}: {
  initial: HomeAddressParts & { lat: number | null; lng: number | null };
  /** What is on file, or English alone when never asked. */
  languages: string[];
}) {
  const [languages, setLanguages] = useState<string[]>(initialLanguages);
  const router = useRouter();
  const [address, setAddress] = useState<HomeAddressParts>({
    flat: initial.flat,
    house: initial.house,
    street: initial.street,
    area: initial.area,
    town: initial.town,
    postcode: initial.postcode,
  });
  const [search, setSearch] = useState(initial.postcode);
  const [pin, setPin] = useState<LatLng | null>(
    initial.lat !== null && initial.lng !== null ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [pending, start] = useTransition();

  const line = addressLine(address);
  const errors = addressErrors({
    line,
    town: address.town,
    postcode: address.postcode,
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
  });
  const missing = homeAddressMissing(address) ?? errors.lat ?? null;

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
      const found = await lookupPostcode(search);
      if (!found.ok) setNote(found.message);
      else {
        setPin({ lat: found.lat, lng: found.lng });
        const pc = formatPostcode(search);
        setSearch(pc);
        setAddress((a) => ({ ...a, postcode: pc }));
      }
    });
  }

  function next() {
    if (!pin) return;
    setError(null);
    start(async () => {
      // Languages first: saving the address is what completes the step.
      const spoken = await saveLanguages(languages);
      if (!spoken.ok) {
        setError(spoken.message);
        return;
      }
      const result = await saveAddress({ address, lat: pin.lat, lng: pin.lng });
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/3');
    });
  }

  return (
    <>
      <WizardTop
        step={2}
        heading="Where do you live?"
        sub="We use it to work out how far each venue is from you — closer shifts rank higher and Radar shows distances from here."
      />

      <div className="row">
        <div className="grow">
          <Input
            aria-label="Postcode search"
            placeholder="Your postcode, e.g. E2 0RY"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={findPostcode} disabled={pending || search.trim() === ''}>
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

      <AddressFields value={address} onChange={setAddress} />
      <div className="xs muted">
        You can change your address later in Profile details — the office is notified of the change.
      </div>

      <LanguagesQuestion value={languages} onChange={setLanguages} disabled={pending} />

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
