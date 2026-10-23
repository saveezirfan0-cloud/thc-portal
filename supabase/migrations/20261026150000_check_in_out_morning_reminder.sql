-- =====================================================================
-- Migration 20261026150000 · the morning check-in / check-out reminder
--                            (CK1, ADR-0205)
--
-- THC (23.10.2026): staff are still getting used to checking in and out
-- on the new Staff App. Remind every worker at 07:00 on the morning of a
-- shift, or earlier if the shift starts earlier, to check in and check
-- out, so their pay is not delayed. N9's two pushes (30 minutes before
-- the start and before the end) are unchanged; this is on top of them.
--
-- 1 · check_in_out_morning_tick(): CK1 to every worker with a confirmed
--     booking whose section starts later that UK day, from
--     kit_reminder_due_at() (07:00 UK, or start - 3 h if earlier, never
--     before the UK day begins — CR2's time) until the start. Not to a
--     worker already checked in (status 'worked', or a check_logs row
--     with a check-in, as N9 reads it). ONE per worker per UK day,
--     however many shifts they have: the key is staff + UK date, and the
--     push names the earliest shift due when it goes. A booking confirmed
--     after the morning, before its start, is reminded at the next tick.
--     Its own function and its own code (not a line on CR2): CR2 stops
--     once the kit message is acknowledged, this must not; and it has its
--     own switch on /settings. Called every minute by booking-tick.
-- 2 · notification_priorities(), restated from 20261025110000 with CK1
--     (urgent, as CR2).
-- 3 · notification_outbox_deletable_templates(), restated from
--     20261020130300 with CK1: its key carries a day that is over.
--
-- Forward-only. client_kit_reminder_tick() is not touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · CK1
-- ---------------------------------------------------------------------
create or replace function public.check_in_out_morning_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ck1 int := 0;
begin
  with due as (
    select distinct on (b.staff_id, (s.starts_at at time zone 'Europe/London')::date)
           b.id as booking_id, b.staff_id, s.starts_at, s.ends_at, e.title as event_title,
           (s.starts_at at time zone 'Europe/London')::date as uk_day
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e             on e.id = s.event_id
     where b.status = 'confirmed'
       and b.cancelled_at is null
       and e.cancelled_at is null
       -- The due time is never more than a UK day (25 h on a clock change)
       -- before the start: a bound the planner can use before the test.
       and s.starts_at >  p_now
       and s.starts_at <= p_now + interval '25 hours'
       and p_now >= kit_reminder_due_at(s.starts_at)
       and not exists (select 1 from check_logs c
                        where c.booking_id = b.id and c.check_in_at is not null)
     order by b.staff_id, (s.starts_at at time zone 'Europe/London')::date, s.starts_at, b.id
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'CK1:staff:' || staff_id || ':' || to_char(uk_day, 'YYYY-MM-DD'), 'push', 'CK1', staff_id,
           jsonb_build_object('bookingId', booking_id::text,
                              'event',     event_title,
                              'window',    to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                           || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_ck1 from queued;

  return jsonb_build_object('ck1', v_ck1);
end $$;

comment on function public.check_in_out_morning_tick(timestamptz) is
  'ADR-0205: queues CK1 ("Check in and out today") for every worker with a confirmed booking not yet checked in, from kit_reminder_due_at() (07:00 UK, or start - 3 h if earlier) until the start. One per worker per UK day (key CK1:staff:<id>:<UK date>), naming the earliest shift due. Called every minute by the booking-tick Edge Function beside booking_tick().';

revoke execute on function public.check_in_out_morning_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.check_in_out_morning_tick(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 2 · notification_priorities(), restated from 20261025110000 with CK1
--     (urgent, as CR2). priorityValuesSql() renders these rows.
-- ---------------------------------------------------------------------
create or replace function public.notification_priorities()
returns table (code text, priority smallint)
language sql immutable set search_path = public, extensions as $$
  select v.code, v.priority::smallint from (values
    ('BG08', 1),
    ('CK1', 0),
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
    ('DR1', 1),
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
    ('INV1', 1),
    ('IR1', 2),
    ('N1', 2),
    ('N10', 0),
    ('N10b', 0),
    ('N10c', 0),
    ('N10d', 0),
    ('N10e', 0),
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
    ('OC4', 2),
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
    ('RC5', 1),
    ('SC1', 0),
    ('TK1', 1)
  ) as v(code, priority)
$$;

comment on function public.notification_priorities() is
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180), SC1 20261023100000 (ADR-0185), TK1 20261025110000 (ADR-0202), CK1 20261026150000 (ADR-0205).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;

-- ---------------------------------------------------------------------
-- 3 · notification_outbox_deletable_templates(), restated from
--     20261020130300 with CK1 (its key carries a UK date).
-- ---------------------------------------------------------------------
create or replace function public.notification_outbox_deletable_templates()
returns text[]
language sql
immutable
set search_path = public, extensions
as $$
  select array['IR1','E2','E4','E5','E5b','E7','E10','E12','CL5','CL6',
               'CK1','CP1','CP2','CP3','CR2','CR3',
               'N5','N6','N6b','N7','N9','N9b','N10','N10b','N10c','N10d','N11','N11b',
               'N12','N13','N14',
               'OF1','OF2','OF3','OF4','OF5','OF6','OM1','OM2',
               'RC1','RC2','RC3','RC4','RC5']::text[]
$$;

comment on function public.notification_outbox_deletable_templates() is
  'ADR-0164: the outbox families whose finished rows notification_outbox_purge() deletes after 180 days — the key carries a time or a one-off thing that is over, is never numbered by counting rows, and no reader needs the row. CK1 added 20261026150000 (ADR-0205). Every other family is tombstoned (key and times kept); NS1 and BG08 are kept whole.';

revoke execute on function public.notification_outbox_deletable_templates() from public, anon, authenticated;
