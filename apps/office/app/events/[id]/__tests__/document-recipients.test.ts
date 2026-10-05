import { describe, expect, it } from 'vitest';
import {
  parseAddresses,
  recipientsRefusal,
  recipientsRpcRefusal,
  recipientsToSave,
  splitRecipients,
} from '../document-recipients';

const CLIENT = ['Hannah.Brooks@leonardo.co.uk', 'marco@leonardo.co.uk', 'events@leonardo.co.uk'];

describe('ADR-0089 · who receives the timesheet for one event', () => {
  it('reads commas, semicolons, spaces and new lines; lower-cases and drops repeats', () => {
    expect(parseAddresses('A@x.co, b@x.co;\n C@x.co  a@X.co')).toEqual([
      'a@x.co',
      'b@x.co',
      'c@x.co',
    ]);
    expect(parseAddresses('  ')).toEqual([]);
  });

  it('refuses a bad address and more than ten, but allows none (the client card)', () => {
    expect(recipientsRefusal([])).toBeNull();
    expect(recipientsRefusal(['a@x.co', 'b@x.co'])).toBeNull();
    expect(recipientsRefusal(['a@x.co', 'nope'])).toBe('“nope” is not an email address.');
    expect(recipientsRefusal(Array.from({ length: 11 }, (_, i) => `${i}@x.co`))).toBe(
      'Up to 10 recipients per event.',
    );
  });

  it('shows every client contact ticked when the event has no list of its own', () => {
    expect(splitRecipients(CLIENT, null)).toEqual({ ticked: CLIENT, extra: [] });
  });

  it('ticks the chosen client contacts and lists the rest as extra', () => {
    expect(splitRecipients(CLIENT, ['marco@leonardo.co.uk', 'ops@venue.co.uk'])).toEqual({
      ticked: ['marco@leonardo.co.uk'],
      extra: ['ops@venue.co.uk'],
    });
  });

  it('saves null when everyone on the client card is ticked and nothing is added', () => {
    expect(recipientsToSave(CLIENT, CLIENT, [])).toBeNull();
    // …so a contact added to the client card later still reaches this event.
  });

  it('saves the explicit list otherwise', () => {
    expect(recipientsToSave(CLIENT, ['marco@leonardo.co.uk'], [])).toEqual([
      'marco@leonardo.co.uk',
    ]);
    expect(recipientsToSave(CLIENT, CLIENT, ['ops@venue.co.uk'])).toEqual([
      ...CLIENT.map((c) => c.toLowerCase()),
      'ops@venue.co.uk',
    ]);
    expect(recipientsToSave(CLIENT, [], ['ops@venue.co.uk'])).toEqual(['ops@venue.co.uk']);
  });

  it('turns the server refusals into sentences', () => {
    expect(recipientsRpcRefusal('invalid_recipient_email')).toMatch(/not an email/);
    expect(recipientsRpcRefusal('too_many_recipients')).toMatch(/Up to 10/);
    expect(recipientsRpcRefusal('event_cancelled')).toMatch(/cancelled/);
    expect(recipientsRpcRefusal('admins_only')).toMatch(/admin/);
  });
});
