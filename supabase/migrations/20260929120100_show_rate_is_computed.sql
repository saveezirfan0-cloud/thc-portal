-- =====================================================================
-- Migration 20260929120100 · the show-rate is computed (§6, §9.5, §9.6,
--                            BG-03, audit D7, ADR-0033)
--
-- `staff.reliability` — the show-rate, the heaviest factor in the
-- auto-assign score (30 %, §6) — was seeded and never written again, so a
-- worker who missed every shift kept the number they were created with.
--
-- The rule, as ADR-0033 records it:
--
--   show-rate = attended ÷ due, over the worker's bookings whose outcome is
--   decided:
--     attended  status `worked` (checked in, or registered by Get back /
--               Resolve on the No-show — §3.3) or `turned_away` (they came;
--               the strict buffer sent them home, RULE-15), with no
--               unresolved No-show on the booking;
--     missed    any booking with an UNRESOLVED `no_show` violation, the
--               automatic one at start + 30 (BG-03) or the manager's.
--   A booking still waiting on its start, or inside the grace, is neither.
--   Until three bookings are decided the worker sits at 90 — the score's
--   zero point, so a newcomer is neither boosted nor penalised (§6:
--   (reliability − 90) / 10 × 100).
--
-- Other violation types (Late, Left early, Left the geofence, No
-- check-out) do not move it today. §9.5 says a violation "affects the
-- show-rate" and Resolve "removes or reduces" the effect; how much each
-- type weighs is THC's to decide, and ADR-0033 lists it as open. Changing
-- it is one function: staff_show_rate().
--
-- Kept current by two triggers, and backfilled for everyone below:
--   bookings    a status moving into or out of worked / turned_away, a
--               booking moving to another worker, an attended booking
--               deleted;
--   violations  any insert, update or delete that touches a `no_show`
--               (resolving one reclassifies it to `late`, which is exactly
--               the moment it stops counting).
-- A status change that cannot move the figure — an invitation declined, a
-- confirmation cancelled — recomputes nothing (§3.6: "declining has no
-- effect on the show-rate").
-- =====================================================================

create or replace function public.staff_show_rate(p_staff uuid)
returns numeric
language sql
stable
security definer
set search_path = public, extensions
as $$
  with decided as (
    select exists (select 1 from violations v
                    where v.booking_id = b.id and v.type = 'no_show' and not v.resolved) as missed
      from bookings b
     where b.staff_id = p_staff
       and (b.status in ('worked', 'turned_away')
            or exists (select 1 from violations v
                        where v.booking_id = b.id and v.type = 'no_show' and not v.resolved))
  )
  select case when count(*) < 3 then 90.00::numeric
              else round(100.0 * count(*) filter (where not missed) / count(*), 2) end
    from decided
$$;

comment on function public.staff_show_rate(uuid) is
  'Show-rate (§6 reliability): attended ÷ due over decided bookings — worked / turned_away attended, an unresolved No-show missed; 90 until three are decided (ADR-0033).';

revoke execute on function public.staff_show_rate(uuid) from public, anon, authenticated;
grant  execute on function public.staff_show_rate(uuid) to service_role;

create or replace function public.recompute_reliability(p_staff uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update staff set reliability = staff_show_rate(p_staff)
   where id = p_staff
     and reliability is distinct from staff_show_rate(p_staff)
$$;

comment on function public.recompute_reliability(uuid) is
  'Writes staff_show_rate() onto staff.reliability. Called by the bookings / violations triggers (ADR-0033).';

revoke execute on function public.recompute_reliability(uuid) from public, anon, authenticated;
grant  execute on function public.recompute_reliability(uuid) to service_role;

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
create or replace function public.bookings_recompute_reliability()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('worked', 'turned_away') then
      perform recompute_reliability(new.staff_id);
    end if;
  elsif tg_op = 'DELETE' then
    -- A deleted booking's No-show goes with it (on delete cascade), and the
    -- violations trigger sees that; only an attended one is left to count.
    if old.status in ('worked', 'turned_away') then
      perform recompute_reliability(old.staff_id);
    end if;
  elsif old.staff_id is distinct from new.staff_id then
    perform recompute_reliability(old.staff_id);
    perform recompute_reliability(new.staff_id);
  elsif old.status is distinct from new.status
        and (old.status in ('worked', 'turned_away') or new.status in ('worked', 'turned_away')) then
    perform recompute_reliability(new.staff_id);
  end if;
  return null;
end $$;

revoke execute on function public.bookings_recompute_reliability() from public, anon, authenticated;

drop trigger if exists bookings_recompute_reliability_t on bookings;
create trigger bookings_recompute_reliability_t
after insert or update of status, staff_id or delete on bookings
for each row execute function public.bookings_recompute_reliability();

-- ---------------------------------------------------------------------
-- violations
-- ---------------------------------------------------------------------
create or replace function public.violations_recompute_reliability()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    if new.type = 'no_show' then perform recompute_reliability(new.staff_id); end if;
  elsif tg_op = 'DELETE' then
    if old.type = 'no_show' then perform recompute_reliability(old.staff_id); end if;
  elsif (old.type = 'no_show' or new.type = 'no_show')
        and (old.type is distinct from new.type
             or old.resolved is distinct from new.resolved
             or old.booking_id is distinct from new.booking_id
             or old.staff_id is distinct from new.staff_id) then
    perform recompute_reliability(new.staff_id);
    if old.staff_id is distinct from new.staff_id then
      perform recompute_reliability(old.staff_id);
    end if;
  end if;
  return null;
end $$;

revoke execute on function public.violations_recompute_reliability() from public, anon, authenticated;

drop trigger if exists violations_recompute_reliability_t on violations;
create trigger violations_recompute_reliability_t
after insert or update or delete on violations
for each row execute function public.violations_recompute_reliability();

-- ---------------------------------------------------------------------
-- Backfill: every worker, from the history already recorded.
-- ---------------------------------------------------------------------
update staff s set reliability = staff_show_rate(s.id)
 where s.reliability is distinct from staff_show_rate(s.id);
