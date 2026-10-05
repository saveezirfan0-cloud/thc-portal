import { isEmail } from '../../clients/validate';

/**
 * Who the timesheets for ONE event go to (ADR-0086). Null/empty is "every
 * contact email on the client card"; otherwise 1–5 addresses for this event
 * only, picked from the client's contacts and/or typed in. The database
 * (`set_event_document_recipients`) checks the same things and is the one
 * that decides; these are the form's half, so a mistake reads as a sentence
 * before the round trip.
 */
export const MAX_DOCUMENT_RECIPIENTS = 5;

/** "a@x.co, B@x.co; c@x.co" → ["a@x.co", "b@x.co", "c@x.co"]: lower-cased, no repeats, in order. */
export function parseAddresses(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const address = raw.trim().toLowerCase();
    if (address && !seen.has(address)) {
      seen.add(address);
      out.push(address);
    }
  }
  return out;
}

/** Null when the list may be saved. An empty list is allowed: it means the client card. */
export function recipientsRefusal(list: readonly string[]): string | null {
  if (list.length > MAX_DOCUMENT_RECIPIENTS) {
    return `Up to ${MAX_DOCUMENT_RECIPIENTS} recipients per event.`;
  }
  const bad = list.find((address) => !isEmail(address));
  if (bad) return `“${bad}” is not an email address.`;
  return null;
}

/** The server's refusal codes, as sentences. */
export function recipientsRpcRefusal(message: string): string {
  if (/invalid_recipient_email/.test(message)) return 'One of those is not an email address.';
  if (/too_many_recipients/.test(message))
    return `Up to ${MAX_DOCUMENT_RECIPIENTS} recipients per event.`;
  if (/event_cancelled/.test(message)) return 'A cancelled event has no timesheet to send.';
  if (/event_not_found/.test(message)) return 'That event no longer exists.';
  if (/admins_only|42501/.test(message)) return 'Only an office admin can choose the recipients.';
  return `The recipients were not saved: ${message}`;
}

/**
 * The checkbox rows for the editor: every client contact (ticked when it is
 * chosen, or when no override is set), then any chosen address that is not
 * on the client card, then the free-text remainder is parsed back from the box.
 */
export function splitRecipients(
  clientContacts: readonly string[],
  chosen: readonly string[] | null,
): { ticked: string[]; extra: string[] } {
  if (chosen === null) return { ticked: [...clientContacts], extra: [] };
  const known = new Set(clientContacts.map((c) => c.toLowerCase()));
  return {
    ticked: clientContacts.filter((c) => chosen.includes(c.toLowerCase())),
    extra: chosen.filter((c) => !known.has(c)),
  };
}

/**
 * What the form saves: null (back to the client card) when every client
 * contact is ticked and nothing else was added — so a later change to the
 * client card still reaches this event — otherwise the explicit list.
 */
export function recipientsToSave(
  clientContacts: readonly string[],
  ticked: readonly string[],
  extra: readonly string[],
): string[] | null {
  const all = new Set(clientContacts.map((c) => c.toLowerCase()));
  const chosen = [...new Set([...ticked.map((t) => t.toLowerCase()), ...extra])];
  const everyContact = [...all].every((c) => chosen.includes(c));
  if (everyContact && chosen.length === all.size) return null;
  return chosen;
}
