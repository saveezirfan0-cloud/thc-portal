/**
 * Ids in the portal's URLs and server actions.
 *
 * Every event and booking id is a Postgres `uuid`. Anything else in
 * `/client/events/:id` is a URL nobody was given, so the page answers it
 * with not-found before a query is made: handed to PostgREST, `not-a-uuid`
 * comes back as `invalid input syntax for type uuid`, which is a database
 * message and never something a customer should read.
 *
 * Any version, any variant — the shape is what Postgres accepts, not what
 * a generator produces. Pure, so the browser can import it too.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
