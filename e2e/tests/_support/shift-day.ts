import { createActivatedLogin, lit, sql } from './db';
import type { Candidate } from './db';

/**
 * The day of a shift, made in the database for a browser journey (§5.1,
 * §9.5, §10.4, §10.6, §10.7).
 *
 * What `createCandidateInDocuments()` cannot give: a worker who is ALREADY
 * working. `attempt_check_in()` (20260930100000, D16) refuses anyone whose
 * `staff.status` is not `compliant`, and the only way through the row guard
 * from `documents` to `compliant` is the whole eleven-step wizard — Storage
 * uploads, a selfie, the quiz, the contract (supabase/tests/393 walks it).
 * So a working worker is inserted the way supabase/seed.sql and the pgTAP
 * fixtures (supabase/tests/_shared/fixtures.psql) insert theirs: a
 * `compliant` row with an Employee ID and a signed contract, UK/Irish right
 * to work (no visa expiry, no term-time cap: RULE-20 leaves 48 h), one
 * role. `staff_status_guard` fires on UPDATE of status only, so the insert
 * is not an edge of the machine; nothing on the row is invented that a
 * compliant worker would not carry. With no documents on file
 * `compliance_blockers()` is empty, so `appLock()` is `none` and the Staff
 * App opens on Shifts (§10.1).
 *
 * Everything is scoped to rows this file creates: a client of its own (so
 * no seeded customer's list, board or portal gains an event), an event on a
 * seeded venue, one role section, and bookings on it. The names carry a
 * per-run tag so two runs against one database never read each other's
 * rows. `removeDay()` takes all of it out again, best effort.
 *
 * Every statement here was dry-run against a cluster built by
 * scripts/pgtest-local.sh (all migrations + seed.sql).
 */

/** Leonardo Royal Hotel, seeded (supabase/seed.sql): 51.5133, −0.0990, 150 m fence. */
export const SEEDED_VENUE = '50000000-0000-4000-8000-000000000001';
/** Waiting Staff, seeded: base £14.00 (§9.8 — the worker sees this and nothing else). */
export const WAITING_STAFF = '30000000-0000-4000-8000-000000000001';
export const PASSWORD = 'Copper-Lantern-8191';

export interface Worker extends Candidate {
  employeeId: number;
  /** Null for a worker who never signs in (the other names on a board). */
  userId: string | null;
}

export interface Day {
  tag: string;
  clientId: string;
  eventId: string;
  eventTitle: string;
  shiftId: string;
  venue: { latitude: number; longitude: number; radiusM: number };
}

/** A tag no other run shares: in names, titles and emails. */
export function runTag(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/**
 * One compliant worker (see the header for why it is an insert). With
 * `login`, `createActivatedLogin()` gives them a password and the `staff`
 * role the middleware admits (§1.4).
 *
 * The first name is what the event board shows ("Kestrel Q.", `shortName`
 * in apps/office/app/events/[id]/board-model.ts), so callers pass one no
 * other fixture uses; the last name carries the run tag.
 */
export function createWorker(tag: string, firstName: string, login: boolean): Worker {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const lastName = `Day${tag}`;
  const email = `e2e.${firstName.toLowerCase()}.${unique}@example.test`;
  // Ofcom's 07700 900xxx drama range, as the seed's workers use.
  const phone = `+447700${unique.slice(-6)}`;

  const [staffId, employeeId] = sql(
    `insert into staff (employee_id, first_name, last_name, email, phone, dob, home_address,
                        home_location, status, rtw_branch, contract_signed_at, contract_version,
                        gender, gdpr_consent_at)
     values (nextval('employee_id_seq'), ${lit(firstName)}, ${lit(lastName)}, ${lit(email)},
             ${lit(phone)}, date '1996-03-14', 'Clerkenwell, London EC1R 0AA',
             st_setsrid(st_makepoint(-0.1050, 51.5240), 4326)::geography,
             'compliant', 'uk_irish', now() - interval '60 days', current_contract_version(),
             'F', now() - interval '90 days')
     returning id, employee_id`,
  ).split('\t');
  if (!staffId || !/^[0-9a-f-]{36}$/.test(staffId)) {
    throw new Error(`could not create a compliant worker for ${email}: [${staffId}]`);
  }
  sql(
    `insert into staff_roles (staff_id, role_id) values (${lit(staffId)}, ${lit(WAITING_STAFF)})`,
  );

  const worker: Worker = {
    staffId,
    email,
    firstName,
    lastName,
    employeeId: Number(employeeId),
    userId: null,
  };
  if (login) worker.userId = createActivatedLogin(worker, PASSWORD);
  return worker;
}

/**
 * Today's event with one role section that started ten minutes ago.
 *
 * The section is [now − 10 min, now + 3 h 50 min]: §3.2's four-hour minimum
 * is a table constraint (`shift_requirements.min_4h`), so it cannot be
 * clamped at UK midnight the way supabase/tests/240 clamps a start. After
 * 20:10 UK it therefore runs past midnight, as the seed's Product Launch
 * does. Nothing asserted on it depends on the UK day: the monitor reads
 * every section that OVERLAPS today (`ukDayBounds`, apps/office/app/checkin
 * /log.ts), and check-in/out are measured from the section's own start and
 * end (RULE-18). `event_date` is the UK date of the START, so in the ten
 * minutes after UK midnight it is correctly yesterday's.
 *
 * Ten minutes in: check-out is open (§5.1 "once the shift has started"),
 * check-in has not locked (start + 30), and the RULE-15 turn-away is still
 * inside the grace, so it is the paid one (240 minutes). Auto-assign is
 * off on both levels, so neither the hourly rounds nor the §3.4 escalation
 * invites seeded workers onto a section that is short by design.
 *
 * `strictBuffer` is the event's `pays_buffer = false` (§3.2): past the
 * headcount, a check-in is turned away.
 */
export function createStartedDay(
  tag: string,
  opts: { headcount: number; buffer: number; strictBuffer: boolean },
): Day {
  const eventTitle = `E2E Day ${tag}`;
  const row = sql(`
    with c as (
      insert into clients (name, contact_name, phone, staff_contact_point, contact_emails,
                           pays_breaks, pays_buffer)
      values (${lit(`E2E Client ${tag}`)}, 'Journey Contact', '+447700900555', 'Front desk',
              array[${lit(`client.${tag}@example.test`)}], true, ${opts.strictBuffer ? 'false' : 'true'})
      returning id
    ), s as (
      select now() - interval '10 minutes' as starts_at
    ), e as (
      insert into events (client_id, venue_id, venue_name, venue_address, venue_location,
                          geofence_radius_m, title, event_date, onsite_contact, pays_breaks,
                          pays_buffer, auto_assign)
      select c.id, v.id, v.name, v.address, v.location, v.geofence_radius_m, ${lit(eventTitle)},
             (s.starts_at at time zone 'Europe/London')::date, 'Duty Manager', true,
             ${opts.strictBuffer ? 'false' : 'true'}, false
        from c, s, venues v where v.id = ${lit(SEEDED_VENUE)}
      returning id, client_id, venue_location, geofence_radius_m
    ), sr as (
      insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                      charge_rate, pay_rate, dress_code, auto_assign,
                                      allocation_per_hour)
      select e.id, ${lit(WAITING_STAFF)}, s.starts_at, s.starts_at + interval '4 hours',
             ${opts.headcount}, ${opts.buffer}, 22.97, 14.00, 'Black & whites', false,
             ${opts.headcount + opts.buffer}
        from e, s
      returning id, event_id
    )
    select e.client_id, e.id, sr.id, st_y(e.venue_location::geometry), st_x(e.venue_location::geometry),
           e.geofence_radius_m
      from e join sr on sr.event_id = e.id`);
  const [clientId, eventId, shiftId, lat, lng, radius] = row.split('\t');
  if (!shiftId || !/^[0-9a-f-]{36}$/.test(shiftId)) {
    throw new Error(`could not create today's section for ${tag}: [${row}]`);
  }
  return {
    tag,
    clientId: clientId!,
    eventId: eventId!,
    eventTitle,
    shiftId,
    venue: { latitude: Number(lat), longitude: Number(lng), radiusM: Number(radius) },
  };
}

/**
 * A confirmed booking, with both later stages of §3.5 done: "I'm ready"
 * the day before and the on-the-day confirm. Neither gates check-in (the
 * on-the-day one is a reminder only), but a booking without them is one
 * `booking_tick()` has opinions about, and this one should be the plain
 * case. Confirmed two days ago, so it is not the §3.4 "booked after the
 * start" exception to the lock.
 */
export function bookConfirmed(day: Day, worker: Worker): string {
  const id = sql(`
    insert into bookings (shift_id, staff_id, status, source, confirmed_at,
                          day_before_confirmed_at, on_day_confirmed_at)
    values (${lit(day.shiftId)}, ${lit(worker.staffId)}, 'confirmed', 'manual',
            now() - interval '2 days', now() - interval '1 day', now() - interval '1 hour')
    returning id`);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`could not book ${worker.email}: [${id}]`);
  return id;
}

/**
 * A worker who is already on site: the accepted press `attempt_check_in()`
 * writes (an on-site `checked_in` log with its stamp) and the booking
 * `worked`, which is the edge §3.6 takes on check-in. Five minutes ago, on
 * the venue's own point.
 */
export function markCheckedIn(bookingId: string): void {
  sql(`
    insert into check_logs (booking_id, attempted_at, outcome, location, distance_m,
                            check_in_at, on_site_verified)
    select b.id, now() - interval '5 minutes', 'checked_in', e.venue_location, 0,
           now() - interval '5 minutes', true
      from bookings b join shift_requirements sr on sr.id = b.shift_id
      join events e on e.id = sr.event_id
     where b.id = ${lit(bookingId)};
    update bookings set status = 'worked' where id = ${lit(bookingId)};`);
}

/** Gisela M., the seeded admin (supabase/seed.sql) — the office's hand on the RPCs below. */
const OFFICE_UID = '10000000-0000-4000-8000-000000000001';

/**
 * Runs one query as the office would through PostgREST: Gisela's JWT
 * claims, then the `authenticated` role, in one transaction, so
 * `current_app_role()` is `admin` and every guard inside the function runs
 * exactly as it does for the Back Office. Returns the query's own output
 * (the `set_config` line is dropped).
 */
export function asOffice(query: string): string {
  const out = sql(
    `select set_config('request.jwt.claims',
                       ${lit(JSON.stringify({ sub: OFFICE_UID, role: 'authenticated' }))}, true);
     set local role authenticated;
     ${query}`,
  );
  return out.split('\n').slice(1).join('\n');
}

/**
 * §3.3 "No show", recorded the way the board's button records it:
 * `office_mark_no_show()` (20260928110200) — confirmed, no check-in, from
 * the section's start. Returns the violation's id.
 */
export function markNoShow(bookingId: string): string {
  const id = asOffice(`select office_mark_no_show(${lit(bookingId)}) ->> 'violationId'`);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`no No-show for ${bookingId}: [${id}]`);
  return id;
}

/**
 * RULE-02's second trigger, for real: a check-out pressed OFF site with no
 * on-site fix after the check-in. `check_out()` (20260930100000) records
 * the check-in as the finish and raises `no_checkout` for the office to
 * confirm (and, pressed this early, `left_early` too). Pressed through the
 * office's session, which the function admits for any booking.
 */
export function checkOutWithNoFix(bookingId: string): void {
  const reply = asOffice(`select check_out(${lit(bookingId)}, null, null) ->> 'decision'`);
  if (reply !== 'no_on_site_fix') throw new Error(`check_out answered [${reply}]`);
}

/**
 * Takes the day and its people out again. Best effort, like
 * `removeCandidate()`: a leftover row costs nothing (unique tags, CI's
 * database is thrown away), whereas a cleanup that fails a green journey
 * would hide the result that matters.
 *
 * Order is the foreign keys': the event cascades its sections, their
 * bookings, check logs, pings, breaks and violations; the qualification a
 * closed shift grants (D37) and the outbox rows point at the client and
 * the worker without a cascade; the E8/E9 office emails carry the worker
 * only in their key.
 */
export function removeDay(day: Day | null, workers: readonly (Worker | null)[]): void {
  const people = workers.filter((w): w is Worker => w !== null);
  const staffIds = people.map((w) => lit(w.staffId)).join(', ') || 'null';
  try {
    sql(`
      do $$
      declare v_client uuid := ${day ? lit(day.clientId) : 'null'};
              v_event  uuid := ${day ? lit(day.eventId) : 'null'};
              v_users  uuid[];
      begin
        select array_agg(user_id) into v_users from staff where id in (${staffIds}) and user_id is not null;
        delete from notification_outbox
         where recipient_staff_id in (${staffIds})
            or key like any (array(select 'E8:staff:' || s::text || ':%' from unnest(array[${staffIds}]::uuid[]) s))
            or key in (select 'E9:declaration:' || d.id from criminal_declarations d where d.staff_id in (${staffIds}))
            or (v_event is not null and payload::text like '%' || v_event::text || '%');
        delete from audit_log
         where entity_id in (${staffIds})
            or (v_event is not null and entity_id = v_event)
            or (v_users is not null and actor = any (v_users));
        delete from violations where staff_id in (${staffIds});
        if v_event is not null then
          delete from events where id = v_event;
        end if;
        delete from bookings where staff_id in (${staffIds});
        if v_client is not null then
          delete from client_qualifications where client_id = v_client;
          delete from clients where id = v_client;
        end if;
        delete from client_qualifications where staff_id in (${staffIds});
        delete from staff where id in (${staffIds});
        if v_users is not null then
          delete from auth.users where id = any (v_users);
        end if;
      end $$;`);
  } catch (cause) {
    const err = cause && typeof cause === 'object' && 'stderr' in cause ? cause.stderr : cause;
    console.warn(`[e2e] could not remove the day ${day?.tag ?? ''}: ${String(err)}`);
  }
}
