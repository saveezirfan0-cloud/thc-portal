'use client';

import { Input } from '@thc/ui';
import { formatPostcode } from '@thc/domain';
import type { HomeAddressParts } from '../_lib/address';
import './address-fields.css';

/**
 * The home address, one box per part — the wizard's 2/11 and Profile
 * details share it so the two cannot drift. Saved as one line
 * (`joinHomeAddress()`, `_lib/address.ts`). Every box but the flat is
 * required and starred; `homeAddressMissing()` is the rule.
 */
/** A box the worker must fill: the label carries the star (as step 4's declaration does). */
function required(text: string) {
  return (
    <>
      {text} <span className="coral">*</span>
    </>
  );
}

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
            label={required('House no. or name')}
            placeholder="e.g. 22"
            required
            value={value.house}
            onChange={set('house')}
          />
        </div>
        <div className="grow">
          <Input
            label={required('Street name')}
            placeholder="e.g. Roman Road"
            required
            value={value.street}
            onChange={set('street')}
          />
        </div>
      </div>
      <Input
        label={required('Area / county')}
        placeholder="e.g. Bethnal Green"
        required
        value={value.area}
        onChange={set('area')}
      />
      <div className="row">
        <div className="grow">
          <Input
            label={required('Town / city')}
            required
            value={value.town}
            onChange={set('town')}
            autoComplete="address-level2"
          />
        </div>
        <div className="postcode-field">
          <Input
            label={required('Postcode')}
            mono
            required
            value={value.postcode}
            onChange={set('postcode')}
            onBlur={() => onChange({ ...value, postcode: formatPostcode(value.postcode) })}
            autoComplete="postal-code"
          />
        </div>
      </div>
      <div className="xs muted">
        <span className="coral">*</span> Required. Only the flat or apartment can be left blank.
      </div>
    </>
  );
}
