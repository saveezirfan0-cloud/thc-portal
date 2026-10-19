-- =====================================================================
-- The outbox drain claims time-critical sends first, and hands back what
-- it did not get to (ADR-0158).
--
-- Until now claim_outbox_batch() took the oldest due rows. The live outbox
-- has seen 1,035 rows queued in one minute (the OC1/IR1 chasers); at 40 a
-- run that is ~26 minutes, and N9 "time to check in" (sent 30 minutes
-- before the start), N6b "you've been released" and N5 invitations waited
-- behind it. This migration:
--
--   1. notification_priorities() — the register's send class per code,
--      0 urgent · 1 normal · 2 bulk. The table is
--      packages/notifications/src/priority.ts (SEND_PRIORITY); its
--      priorityValuesSql() renders the `values` below, and
--      __tests__/priority.test.ts fails while the two differ. An unknown
--      code is normal (notification_priority()), so a row is never held
--      for want of a class — and supabase/tests/856 fails instead.
--   2. notification_outbox.priority, set at insert (and on a change of
--      template) by a trigger from that mapping. Callers do not set it:
--      every enqueue path in the product gets it without being touched.
--      Rows still waiting are backfilled; settled rows keep the default,
--      since the column only orders the claim.
--   3. claim_outbox_batch() orders by priority, then send_after. The
--      body is 20261002113000's (the latest; it settles switched-off rows
--      first) with that one line changed. `for update skip locked`, the
--      lease and the unique key are as they were.
--   4. An index in exactly that order over the rows a claim can take.
--   5. release_outbox_claims(ids[]) — the drain's run budget: rows claimed
--      but not started before the run stops are handed back at once,
--      without counting an attempt and without touching their last error,
--      so the next run (a minute later) takes them in priority order
--      rather than after the five-minute lease.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The mapping
-- ---------------------------------------------------------------------
create or replace function public.notification_priorities()
returns table (code text, priority smallint)
language sql immutable set search_path = public, extensions as $$
  select v.code, v.priority::smallint from (values
    ('BG08', 1),
    ('CL1', 1),
    ('CL2', 1),
    ('CL3', 1),
    ('CL4', 2),
    ('CL5', 1),
    ('CL6', 1),
    ('CP1', 1),
    ('CP2', 1),
    ('CP3', 1),
    ('CR1', 1),
    ('CR2', 0),
    ('CR3', 1),
    ('D1', 1),
    ('D2', 1),
    ('E1', 1),
    ('E10', 0),
    ('E11', 1),
    ('E12', 1),
    ('E2', 1),
    ('E2b', 1),
    ('E3', 1),
    ('E4', 1),
    ('E5', 1),
    ('E5b', 1),
    ('E6', 1),
    ('E7', 1),
    ('E8', 1),
    ('E9', 1),
    ('IR1', 2),
    ('N1', 2),
    ('N10', 0),
    ('N10b', 0),
    ('N10c', 0),
    ('N10d', 0),
    ('N11', 0),
    ('N11b', 0),
    ('N12', 0),
    ('N13', 0),
    ('N14', 1),
    ('N15', 1),
    ('N2', 2),
    ('N3', 2),
    ('N4', 1),
    ('N5', 0),
    ('N6', 0),
    ('N6b', 0),
    ('N7', 0),
    ('N8', 1),
    ('N9', 0),
    ('N9b', 0),
    ('NS1', 1),
    ('OC1', 2),
    ('OC2', 2),
    ('OC3', 2),
    ('OF1', 0),
    ('OF2', 0),
    ('OF3', 0),
    ('OF4', 0),
    ('OF5', 0),
    ('OF6', 0),
    ('OM1', 0),
    ('OM2', 0),
    ('RC1', 1),
    ('RC2', 1),
    ('RC3', 1),
    ('RC4', 1),
    ('RC5', 1)
  ) as v(code, priority);
$$;

comment on function public.notification_priorities() is
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal).';

create or replace function public.notification_priority(p_template text)
returns smallint
language sql immutable set search_path = public, extensions as $$
  select coalesce((select p.priority from notification_priorities() p where p.code = p_template),
                  1::smallint);
$$;

comment on function public.notification_priority(text) is
  'ADR-0158: claim order for an outbox row of this template, from notification_priorities(). An unknown code is 1 (normal), so it is never held back.';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
revoke execute on function public.notification_priority(text) from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
grant execute on function public.notification_priority(text) to service_role;

-- ---------------------------------------------------------------------
-- 2 · The column, set at insert
-- ---------------------------------------------------------------------
alter table notification_outbox
  add column if not exists priority smallint not null default 1
    constraint notification_outbox_priority_class check (priority between 0 and 2);

comment on column notification_outbox.priority is
  'ADR-0158: claim order, 0 urgent · 1 normal · 2 bulk. Set from notification_priority(template) by notification_outbox_set_priority on insert and on a change of template; never by a caller. Rows settled before 20261019160000 carry the default.';

-- security definer: the trigger fires for whoever inserts, and the mapping
-- is the service role's. Without it a signed-in caller's insert would fail
-- on the mapping's grant instead of reaching RLS, which is what refuses it
-- (supabase/tests/310).
create or replace function public.notification_outbox_set_priority()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.priority := notification_priority(new.template);
  return new;
end;
$$;

revoke execute on function public.notification_outbox_set_priority() from public, anon, authenticated;

drop trigger if exists notification_outbox_set_priority on notification_outbox;
create trigger notification_outbox_set_priority
  before insert or update of template on notification_outbox
  for each row execute function public.notification_outbox_set_priority();

-- Only the rows a claim can still take; the rest are history.
update notification_outbox o
   set priority = notification_priority(o.template)
 where o.sent_at is null and o.failed_at is null
   and o.priority is distinct from notification_priority(o.template);

-- ---------------------------------------------------------------------
-- 3 · The claim, in priority order
-- ---------------------------------------------------------------------
-- 20261002113000's body (the latest definition) with one change: the
-- `order by` of the `due` CTE. The switched-off settle, `skip locked`, the
-- lease and the attempt count are unchanged.
create or replace function public.claim_outbox_batch(
  p_limit integer default 50, p_lease interval default interval '5 minutes'
) returns setof notification_outbox
language plpgsql security definer set search_path = public, extensions as $$
begin
  update notification_outbox o
     set failed_at = now(),
         error = 'Not sent: switched off in Settings'
   where o.sent_at is null and o.failed_at is null and o.send_after <= now()
     and not notification_switched_on(o.template);

  return query
  with due as (
    select o.id from notification_outbox o
     where o.sent_at is null and o.failed_at is null and o.send_after <= now()
     order by o.priority, o.send_after, o.id
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update notification_outbox o
     set attempts = o.attempts + 1,
         last_attempt_at = now(),
         send_after = now() + p_lease      -- the lease: hides it from other runners
    from due
   where o.id = due.id
  returning o.*;
end;
$$;

-- ---------------------------------------------------------------------
-- 4 · The index the claim reads
-- ---------------------------------------------------------------------
create index if not exists notification_outbox_claim_idx
  on notification_outbox (priority, send_after, id)
  where sent_at is null and failed_at is null;

-- ---------------------------------------------------------------------
-- 5 · Handing back the claims a run did not start
-- ---------------------------------------------------------------------
-- Like release_outbox_claim (20260924100000) but for many rows, due again
-- at once, and leaving `error` as it was: nothing went wrong with these
-- rows, the run simply ran out of time. Only an unsettled row still under
-- a lease (`send_after > now()`) is touched. The drain passes only ids it
-- claimed in this run and never started, well inside the five-minute
-- lease, so no other drain can hold them.
create or replace function public.release_outbox_claims(p_ids bigint[])
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_n integer;
begin
  update notification_outbox
     set attempts   = greatest(attempts - 1, 0),
         send_after = now()
   where id = any(coalesce(p_ids, '{}'::bigint[]))
     and sent_at is null and failed_at is null
     and send_after > now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.release_outbox_claims(bigint[]) is
  'notify-drain (ADR-0158): hand back claims the run did not start before its time budget ran out — due again at once, the attempt not counted, the last error kept. Service role only.';

revoke execute on function public.release_outbox_claims(bigint[]) from public, anon, authenticated;
grant execute on function public.release_outbox_claims(bigint[]) to service_role;
