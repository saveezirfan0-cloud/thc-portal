/**
 * `/events/new?client=<id>` — the target of "+ New event for this client" on
 * the client card (§9.7, `wireframes/backoffice/client-card.html`).
 *
 * The parameter is only honoured when it names a client in the Shift
 * Builder's own reference list: a stale or hand-typed id opens the builder
 * with the picker empty, exactly as without it, rather than with a value
 * the select cannot show. A repeated parameter takes the first.
 */
export function preselectClient<T extends { id: string }>(
  clients: readonly T[],
  param: string | string[] | undefined,
): T | undefined {
  const id = Array.isArray(param) ? param[0] : param;
  if (!id) return undefined;
  return clients.find((client) => client.id === id);
}
