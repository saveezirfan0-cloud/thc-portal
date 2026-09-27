import { describe, expect, it } from 'vitest';
import {
  EMPTY_ADDRESS,
  addressLine,
  homeAddressMissing,
  isBlankAddress,
  joinHomeAddress,
  splitHomeAddress,
} from '../address';
import { extractPostcode } from '../postcode';

const roman = {
  flat: 'Flat 4',
  house: '22',
  street: 'Roman Road',
  area: '',
  town: 'London',
  postcode: 'e20ry',
};

describe('home address boxes → the one stored line', () => {
  it('writes the shape onboarding_save_address() has always written', () => {
    expect(joinHomeAddress(roman)).toBe('Flat 4, 22 Roman Road, London E2 0RY');
    expect(addressLine(roman)).toBe('Flat 4, 22 Roman Road');
  });

  it('a house number sits in front of the street; a house name takes a comma', () => {
    expect(addressLine({ ...roman, flat: '', house: '22a' })).toBe('22a Roman Road');
    expect(addressLine({ ...roman, flat: '', house: '4-6' })).toBe('4-6 Roman Road');
    expect(addressLine({ ...roman, flat: '', house: 'Rose Cottage', street: 'Mill Lane' })).toBe(
      'Rose Cottage, Mill Lane',
    );
  });

  it('carries the optional area line', () => {
    expect(joinHomeAddress({ ...roman, area: 'Bethnal Green' })).toBe(
      'Flat 4, 22 Roman Road, Bethnal Green, London E2 0RY',
    );
  });

  it('keeps the postcode at the end, where the geocoder reads it', () => {
    expect(extractPostcode(joinHomeAddress(roman))).toBe('E2 0RY');
  });
});

describe('the stored line → boxes', () => {
  it('round-trips what it writes', () => {
    for (const parts of [
      roman,
      { ...roman, flat: '' },
      { ...roman, area: 'Bethnal Green' },
      { ...roman, flat: '', house: 'Rose Cottage', street: 'Mill Lane' },
    ]) {
      const line = joinHomeAddress(parts);
      expect(joinHomeAddress(splitHomeAddress(line))).toBe(line);
    }
    expect(splitHomeAddress('Flat 4, 22 Roman Road, London E2 0RY')).toEqual({
      flat: 'Flat 4',
      house: '22',
      street: 'Roman Road',
      area: '',
      town: 'London',
      postcode: 'E2 0RY',
    });
  });

  it('a free-hand address with no postcode lands in Street for the worker to tidy', () => {
    expect(splitHomeAddress('somewhere in London')).toEqual({
      ...EMPTY_ADDRESS,
      street: 'somewhere in London',
    });
    expect(splitHomeAddress(null)).toEqual(EMPTY_ADDRESS);
  });
});

describe('what is still missing', () => {
  const complete = { ...roman, area: 'Bethnal Green' };

  it('names the first empty box, in screen order', () => {
    expect(homeAddressMissing(EMPTY_ADDRESS)).toBe('Enter your house number or name');
    expect(homeAddressMissing({ ...roman, street: ' ' })).toBe('Enter your street name');
    expect(homeAddressMissing({ ...roman, area: '' })).toBe('Enter your area or county');
    expect(homeAddressMissing({ ...complete, town: '' })).toBe('Enter your town or city');
    expect(homeAddressMissing({ ...complete, postcode: 'nope' })).toBe(
      'Enter a UK postcode, e.g. E2 0RY',
    );
    expect(homeAddressMissing(complete)).toBeNull();
  });

  it('every box but the flat is required', () => {
    expect(homeAddressMissing({ ...complete, flat: '' })).toBeNull();
    for (const key of ['house', 'street', 'area', 'town', 'postcode'] as const) {
      expect(homeAddressMissing({ ...complete, [key]: '' })).not.toBeNull();
    }
    expect(isBlankAddress(EMPTY_ADDRESS)).toBe(true);
    expect(isBlankAddress(roman)).toBe(false);
  });
});
