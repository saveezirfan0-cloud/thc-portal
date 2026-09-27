'use client';

import { Input } from '@thc/ui';
import { formatPostcode } from '@thc/domain';
import type { HomeAddressParts } from '../_lib/address';
import './address-fields.css';

/**
 * The home address, one box per part — the wizard's 2/11 and Profile
 * details share it so the two cannot drift. Saved as one line
 * (`joinHomeAddress()`, `_lib/address.ts`).
 */
export function AddressFields({
  value,
  onChange,
}: {
  value: HomeAddressParts;
  onChange: (next: HomeAddressParts) => void;
}) {
  const set = (key: keyof HomeAddressParts) => (e: { target: { value: string } }) =>
    onChange({ ...value, [key]: e.target.value });

  return (
    <>
      <Input
        label="Flat / apartment (optional)"
        placeholder="e.g. Flat 4"
        value={value.flat}
        onChange={set('flat')}
      />
      <div className="row">
        <div className="house-field">
          <Input
            label="House no. or name"
            placeholder="e.g. 22"
            value={value.house}
            onChange={set('house')}
          />
        </div>
        <div className="grow">
          <Input
            label="Street name"
            placeholder="e.g. Roman Road"
            value={value.street}
            onChange={set('street')}
          />
        </div>
      </div>
      <Input label="Area (optional)" value={value.area} onChange={set('area')} />
      <div className="row">
        <div className="grow">
          <Input
            label="Town / city"
            value={value.town}
            onChange={set('town')}
            autoComplete="address-level2"
          />
        </div>
        <div className="postcode-field">
          <Input
            label="Postcode"
            mono
            value={value.postcode}
            onChange={set('postcode')}
            onBlur={() => onChange({ ...value, postcode: formatPostcode(value.postcode) })}
            autoComplete="postal-code"
          />
        </div>
      </div>
    </>
  );
}
