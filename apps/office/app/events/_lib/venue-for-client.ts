/**
 * Which venue the Shift Builder shows once a client is chosen (§3.2,
 * ADR-0087).
 *
 * A venue may belong to a client (`venues.client_id`). A client with exactly
 * one venue has no choice to make, so its address is applied the moment the
 * client is picked; a client with several (Hackney Town Council has five)
 * still picks, from its own venues listed first; a client with none leaves
 * the picker as it was.
 */
export interface ClientVenue {
  id: string;
  clientId: string | null;
}

/** The venues tied to this client, in the order the directory lists them. */
export function venuesOfClient<T extends ClientVenue>(venues: readonly T[], clientId: string): T[] {
  if (!clientId) return [];
  return venues.filter((venue) => venue.clientId === clientId);
}

/**
 * The venue id after the client changes to `clientId`.
 *
 *  · exactly one venue of the client → that venue, replacing whatever was there;
 *  · otherwise the current venue stays, unless it is another client's site —
 *    a stale address from the previous client is worse than an empty picker.
 */
export function venueAfterClientPick(
  venues: readonly ClientVenue[],
  clientId: string,
  currentVenueId: string,
): string {
  const own = venuesOfClient(venues, clientId);
  if (own.length === 1) return own[0]!.id;

  const current = venues.find((venue) => venue.id === currentVenueId);
  if (current?.clientId && current.clientId !== clientId) return '';
  return currentVenueId;
}
