import { formatPostcode, isPostcode } from '@thc/domain';

/**
 * The home address as the worker types it: one box per part, so a flat,
 * a house number and a street cannot run together.
 *
 * It is still STORED as one line — `staff.home_address`, which the office,
 * payroll's New Starter report and the postcode lookup all read — in the
 * shape `onboarding_save_address()` has always written:
 *
 *   Flat 4, 22 Roman Road, London E2 0RY
 *   └ flat ┘ └ house + street ┘ └ town ┘ └ postcode ┘
 *
 * so nothing downstream changes. `splitHomeAddress()` reads a saved line
 * back into the boxes; it is best effort for an address typed free-hand
 * before the boxes existed, and whatever it cannot place lands in Street
 * for the worker to tidy.
 */
export interface HomeAddressParts {
  /** "Flat 4", "Apartment 12" — optional. */
  flat: string;
  /** "22", "22a", "4–6", or a house name such as "Rose Cottage". */
  house: string;
  street: string;
  /** District, locality or county — required, like everything but the flat. */
  area: string;
  town: string;
  postcode: string;
}

export const EMPTY_ADDRESS: HomeAddressParts = {
  flat: '',
  house: '',
  street: '',
  area: '',
  town: '',
  postcode: '',
};

/** A house NUMBER sits in front of the street ("22 Roman Road"); a name takes a comma. */
const HOUSE_NUMBER = /^\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?$/i;
const NUMBERED_STREET = /^(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)\s+(.+)$/i;
const TRAILING_POSTCODE = /^(.*),\s*([^,]+?)\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Flat, house + street, area — the part before the town. */
export function addressLine(a: HomeAddressParts): string {
  const house = tidy(a.house);
  const street = tidy(a.street);
  const houseStreet =
    house && street ? `${house}${HOUSE_NUMBER.test(house) ? ' ' : ', '}${street}` : house || street;
  return [tidy(a.flat), houseStreet, tidy(a.area)].filter(Boolean).join(', ');
}

/** The one stored line: `line, town POSTCODE`. */
export function joinHomeAddress(a: HomeAddressParts): string {
  const line = addressLine(a);
  const town = tidy(a.town);
  const postcode = a.postcode.trim() ? formatPostcode(a.postcode) : '';
  const tail = [town, postcode].filter(Boolean).join(' ');
  return [line, tail].filter(Boolean).join(', ');
}

/** A saved line back into its boxes (best effort). */
export function splitHomeAddress(saved: string | null | undefined): HomeAddressParts {
  const text = tidy(saved ?? '');
  if (!text) return { ...EMPTY_ADDRESS };
  const m = TRAILING_POSTCODE.exec(text);
  if (!m) return { ...EMPTY_ADDRESS, street: text };
  const parts = splitLine(m[1]!);
  return { ...parts, town: tidy(m[2]!), postcode: formatPostcode(m[3]!) };
}

function splitLine(line: string): Pick<HomeAddressParts, 'flat' | 'house' | 'street' | 'area'> {
  const segs = line.split(',').map(tidy).filter(Boolean);
  const at = segs.findIndex((s) => NUMBERED_STREET.test(s));
  if (at >= 0) {
    const n = NUMBERED_STREET.exec(segs[at]!)!;
    return {
      flat: segs.slice(0, at).join(', '),
      house: n[1]!,
      street: n[2]!,
      area: segs.slice(at + 1).join(', '),
    };
  }
  if (segs.length >= 2) {
    return { flat: '', house: segs[0]!, street: segs[1]!, area: segs.slice(2).join(', ') };
  }
  return { flat: '', house: '', street: segs[0] ?? '', area: '' };
}

/**
 * The first thing still missing, in the order the boxes appear; null when
 * complete. Everything but the flat is required: a candidate cannot move
 * past 2/11 without a full address.
 */
export function homeAddressMissing(a: HomeAddressParts): string | null {
  if (!tidy(a.house)) return 'Enter your house number or name';
  if (!tidy(a.street)) return 'Enter your street name';
  if (!tidy(a.area)) return 'Enter your area or county';
  if (!tidy(a.town)) return 'Enter your town or city';
  if (!isPostcode(a.postcode)) return 'Enter a UK postcode, e.g. E2 0RY';
  return null;
}

export function isBlankAddress(a: HomeAddressParts): boolean {
  return Object.values(a).every((v) => v.trim() === '');
}
