'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Alert, Button, Input, Modal, Select } from '@thc/ui';
import { VenueMap } from './VenueMap';
import { createVenue, reverseGeocode, updateVenue } from './actions';
import {
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  RADIUS_STEP_M,
  RADIUS_TICKS,
  clampRadius,
  formatCoordinates,
  formatRadius,
} from './geo';
import type { LatLng } from './geo';
import type { Venue, VenueType } from './types';

export interface VenueModalProps {
  /** Null creates; a venue edits it, pre-filled with its pin, address and radius. */
  venue: Venue | null;
  venueTypes: VenueType[];
  onClose: () => void;
  onSaved: () => void;
}

interface Pin {
  point: LatLng;
  address: string;
}

/**
 * Create / edit a venue (§9.11) — a modal over the list, never a screen of
 * its own.
 *
 * Three rules from the scope shape everything below:
 *   · the venue type pre-fills the radius from `venue_types`, so the
 *     standard values are data and the screen never carries a copy;
 *   · the radius is moved only with the slider — not typed, and the circle
 *     is not dragged;
 *   · the address comes from the pin by reverse geocoding and is read-only,
 *     with the coordinates printed underneath as plain text.
 */
export function VenueModal({ venue, venueTypes, onClose, onSaved }: VenueModalProps) {
  const editing = venue !== null;

  const [name, setName] = useState(venue?.name ?? '');
  const [venueType, setVenueType] = useState(venue?.venue_type ?? venueTypes[0]?.key ?? '');
  const [radius, setRadius] = useState(
    venue?.geofence_radius_m ?? venueTypes[0]?.default_radius_m ?? MIN_RADIUS_M,
  );
  const [pin, setPin] = useState<Pin | null>(
    venue ? { point: { lat: venue.lat, lng: venue.lng }, address: venue.address } : null,
  );
  const [lookup, setLookup] = useState<'idle' | 'working' | 'failed'>('idle');
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const selectedType = venueTypes.find((type) => type.key === venueType);

  /**
   * §9.11: "Choosing the venue type pre-fills the slider from the standard
   * table." The manager may then move it anywhere in range for this site,
   * so this runs on the choice, not on every render.
   */
  const applyVenueType = (key: string) => {
    setVenueType(key);
    const chosen = venueTypes.find((type) => type.key === key);
    if (chosen) setRadius(clampRadius(chosen.default_radius_m));
  };

  // ---- reverse geocoding ------------------------------------------------
  // The pin is dragged, so the lookup is debounced and every answer but the
  // last is dropped: a stale response must never overwrite a newer address.
  const request = useRef(0);
  const movePin = (point: LatLng) => {
    // Clear the address with the pin: until the lookup answers there is no
    // address for this point, and Create must not be reachable with the
    // previous one still showing.
    moved.current = true;
    setPin({ point, address: '' });
  };

  const pinLat = pin?.point.lat;
  const pinLng = pin?.point.lng;
  /**
   * An edited venue arrives with its stored address already, so the first
   * render must not look it up again. A flag rather than a comparison of the
   * coordinates: a pin dragged back to where it started has still moved, and
   * its address has already been cleared.
   */
  const moved = useRef(false);

  useEffect(() => {
    if (pinLat === undefined || pinLng === undefined) return;
    if (!moved.current) return;

    const ticket = (request.current += 1);
    setLookup('working');
    setLookupMessage(null);
    const timer = setTimeout(() => {
      void reverseGeocode(pinLat, pinLng).then((result) => {
        if (ticket !== request.current) return;
        if (result.ok) {
          setPin({ point: { lat: pinLat, lng: pinLng }, address: result.address });
          setLookup('idle');
        } else {
          setPin({ point: { lat: pinLat, lng: pinLng }, address: '' });
          setLookup('failed');
          setLookupMessage(result.message);
        }
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [pinLat, pinLng]);

  const markers = useMemo(
    () =>
      pin
        ? [
            {
              id: 'pin',
              lat: pin.point.lat,
              lng: pin.point.lng,
              radiusM: radius,
              // The wireframe prints the radius beside the circle, which is
              // where "does this cover the whole site?" gets answered.
              label: formatRadius(radius),
            },
          ]
        : [],
    [pin, radius],
  );

  const ready = name.trim().length > 0 && pin !== null && pin.address.length > 0 && !!venueType;

  const save = () => {
    if (!pin) return;
    setError(null);
    startSaving(async () => {
      const draft = {
        name: name.trim(),
        address: pin.address,
        lat: pin.point.lat,
        lng: pin.point.lng,
        venue_type: venueType,
        geofence_radius_m: radius,
      };
      const result = venue ? await updateVenue(venue.id, draft) : await createVenue(draft);
      if (result.ok) onSaved();
      else setError(result.message);
    });
  };

  return (
    <Modal
      open
      wide
      // §9.11: a new venue is titled "New venue"; editing is titled with the
      // venue's name.
      title={editing ? venue.name : 'New venue'}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button tone="primary" onClick={save} disabled={!ready || saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create venue'}
          </Button>
        </>
      }
    >
      <div className="venue-form">
        {error ? <Alert tone="coral">{error}</Alert> : null}

        <VenueMap
          markers={markers}
          variant="modal"
          editable
          onMovePin={movePin}
          // Frame the pin when it is first dropped. After that the map
          // stays where the manager put it: VenueMap only gives way when a
          // circle would run off the edge.
          refitKey={pin ? 'pinned' : 'empty'}
          ariaLabel="Venue location — click to drop the pin, drag it to move it"
          hint={
            pin
              ? 'Drag the pin · the circle follows the slider, not the mouse'
              : 'Click the map to drop the pin'
          }
        />

        <div className="grid c2">
          <Input
            label={
              <>
                Venue name <span className="coral">*</span>
              </>
            }
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Claridge's"
            required
          />
          <Select
            label={
              <>
                Venue type <span className="coral">*</span>{' '}
                <span className="muted">· sets the starting radius</span>
              </>
            }
            value={venueType}
            onChange={(event) => applyVenueType(event.target.value)}
          >
            {venueTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label} · {formatRadius(type.default_radius_m)}
              </option>
            ))}
          </Select>
        </div>

        <div className="field">
          <label className="label" htmlFor="venue-radius">
            Geofence radius <span className="coral">*</span>{' '}
            <span className="muted">
              · slider {MIN_RADIUS_M} – {MAX_RADIUS_M} m, not typed, circle not dragged
            </span>
          </label>
          <div className="radius-row">
            <input
              id="venue-radius"
              className="radius-input"
              type="range"
              min={MIN_RADIUS_M}
              max={MAX_RADIUS_M}
              step={RADIUS_STEP_M}
              value={radius}
              onChange={(event) => setRadius(clampRadius(Number(event.target.value)))}
              aria-valuetext={formatRadius(radius)}
            />
            <span className="val" aria-hidden="true">
              {formatRadius(radius)}
            </span>
          </div>
          <div className="ticks" aria-hidden="true">
            {RADIUS_TICKS.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
          <span className="hint">
            {selectedType
              ? `Pre-filled from the venue type (${selectedType.label} → ${formatRadius(selectedType.default_radius_m)}); move it anywhere in range for this specific site so the circle covers the whole venue.`
              : 'Move it anywhere in range for this specific site so the circle covers the whole venue.'}{' '}
            Defaults per type are edited in Settings.
          </span>
        </div>

        <div className="grid c2">
          <Input
            label={
              <>
                Address <span className="muted">· from the pin, read-only</span>
              </>
            }
            value={pin?.address ?? ''}
            readOnly
            className="readonly"
            // The lookup's progress is status, not a value: putting it in
            // `value` would read back as the venue's address.
            placeholder={
              lookup === 'working' ? 'Looking up the address…' : 'Drop the pin to fill this in'
            }
            hint={
              lookup === 'working' ? 'Looking up the address…' : 'Reverse geocoding — not typed.'
            }
            error={lookup === 'failed' ? lookupMessage : undefined}
          />
          <div className="field">
            <span className="label">Coordinates</span>
            <div className="input readonly mono coords">
              {pin ? formatCoordinates(pin.point) : '—'}
            </div>
            <span className="hint">Shown as plain text once a pin is set.</span>
          </div>
        </div>

        {/* The §9.11 standard-radius table, straight from `venue_types`. */}
        <div className="types">
          {venueTypes.map((type) => (
            <span key={type.key}>
              {type.label} <b>{type.default_radius_m}</b>
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
