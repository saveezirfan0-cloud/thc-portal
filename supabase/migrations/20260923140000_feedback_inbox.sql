-- =====================================================================
-- Feedback (§9.10, §11.5, §6) — the office inbox, office entries, and the
-- rating they feed
--
-- Why this exists
-- ---------------
-- `feedback` has existed since 0001 and the portal has written client
-- entries into it since 20260921140000. Nothing read them back as a list,
-- nothing let the office write its own, and — the part that matters —
-- nothing turned any of it into `staff.rating`, the number §6 weights at
-- 25% of the auto-assign score. The column was whatever the seed or an
-- import put there.
--
-- §9.10 settles what the number is made of:
--
--   · "Both types feed the rating score."
--   · Client feedback only "once the manager presses Mark as read —
--     submission alone does not affect the rating".
--   · Office feedback "counts toward the rating immediately on
--     submission".
--
-- So the rating is the mean of the entries that count, and it is kept
-- current by a trigger on `feedback` rather than a nightly job
-- (docs/03-data-model.md anticipated compliance-daily). "Immediately" is
-- the scope's word, and a manager who marks a complaint read and then
-- presses Auto-assign should not be ranked on yesterday's figure.
--
-- What changes
-- ------------
--   1. `read_by` — the wireframe prints "Read · Gisela M. · 07 Sep".
--   2. `event_id` becomes optional FOR OFFICE ENTRIES ONLY. Both
--      wireframes offer "Not tied to an event": a compliment that arrives
--      by phone is often about the person, not a shift. A client entry
--      still needs its event — it is left from the event page (§11.2).
--   3. The rules §9.10 states about editing are enforced here, not only
--      by which buttons the screen draws: a client entry is read-only
--      (the single exception is deleting it after the worker's GDPR
--      removal, to redact a name — §1.7), "Mark as read" happens once and
--      is not undone, and office entries have no read state at all.
--   4. The rating hook, and the RPCs the office screen calls.
--   5. feedback_entries_v — the list both /feedback and the profile's
--      Feedback tab read. It runs with owner rights, see ADR-0016.
--   6. The client's direct INSERT policy is narrowed so that a customer
--      cannot write an entry that is already "read" — which, with a
--      rating hook in place, would otherwise have moved a worker's score
--      from the portal with nobody in the office seeing it.
-- =====================================================================

-- =====================================================================
-- 1–3 · columns and constraints
-- =====================================================================
alter table feedback add column if not exists read_by uuid references profiles(id);
create index if not exists feedback_read_by_idx on feedback (read_by);

alter table feedback alter column event_id drop not null;

alter table feedback drop constraint if exists feedback_client_entry_names_event;
alter table feedback add constraint feedback_client_entry_names_event
  check (author_kind = 'office' or event_id is not null);

-- §9.10: "Mark as read … exists only on client feedback".
alter table feedback drop constraint if exists feedback_only_client_entries_are_read;
alter table feedback add constraint feedback_only_client_entries_are_read
  check (author_kind = 'client' or (read_at is null and read_by is null));

-- The two lists /feedback pages through, newest first, and the unread
-- badge it counts on every load.
create index if not exists feedback_kind_created_idx
  on feedback (author_kind, created_at desc);
create index if not exists feedback_client_unread_idx
  on feedback (created_at desc)
  where author_kind = 'client' and read_at is null;

-- =====================================================================
-- 4a · the one definition of "counts toward the rating"
--
-- staff_profile_v's feedback_count and staff_feedback_v spell this inline
-- (20260922094500); the first is left alone and the second is restated
-- below with its expression unchanged. Everything new calls this, so the
-- trigger, the new views and the tests cannot disagree about which
-- entries the scoring engine is using.
-- =====================================================================
create or replace function public.feedback_counts(p_kind feedback_author, p_read_at timestamptz)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_kind = 'office' or p_read_at is not null
$$;

comment on function public.feedback_counts(feedback_author, timestamptz) is
  '§9.10: an office entry counts toward the rating from submission; a client entry only once it has been marked read.';

-- =====================================================================
-- 4b · the rating
--
-- The mean of the counted entries, to the two places `staff.rating`
-- holds. No counted entry means no rating (NULL), which §6's scorer
-- already reads as the neutral 4.0 (20260921141500, coalesce) — a worker
-- nobody has reviewed is neither credited nor penalised.
--
-- security definer because it writes `staff`, and it is called from a
-- trigger that fires for whoever changed the feedback. It takes a staff
-- id and recomputes from the table, so there is nothing a caller could
-- pass to it that moves a rating by any other route than feedback — but
-- it is still not granted to anybody: the trigger is its only caller.
-- =====================================================================
create or replace function public.recompute_staff_rating(p_staff uuid)
returns numeric
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rating numeric(3,2);
begin
  select round(avg(f.rating)::numeric, 2)
    into v_rating
    from feedback f
   where f.staff_id = p_staff
     and feedback_counts(f.author_kind, f.read_at);

  update staff set rating = v_rating
   where id = p_staff and rating is distinct from v_rating;

  return v_rating;
end $$;

comment on function public.recompute_staff_rating(uuid) is
  '§9.10 / §6: staff.rating = the mean of the worker''s counted feedback (office entries, and client entries once read), NULL when none counts. Called only by feedback_rating_hook().';

revoke all on function public.recompute_staff_rating(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The hook. It recomputes ONLY when the set of counted entries changed.
--
-- That condition is the rule, not an optimisation: §9.10 says submission
-- alone does not affect the rating. Were the hook to recompute on every
-- insert, a portal submission would still rewrite `staff.rating` — for a
-- worker whose only entries are unread, from whatever it was to NULL.
-- ---------------------------------------------------------------------
create or replace function public.feedback_rating_hook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_old_counts boolean := tg_op <> 'INSERT' and feedback_counts(old.author_kind, old.read_at);
  v_new_counts boolean := tg_op <> 'DELETE' and feedback_counts(new.author_kind, new.read_at);
  v_staff      uuid[]  := '{}';
  v_id         uuid;
begin
  if tg_op = 'INSERT' then
    if v_new_counts then v_staff := array[new.staff_id]; end if;
  elsif tg_op = 'DELETE' then
    if v_old_counts then v_staff := array[old.staff_id]; end if;
  elsif v_old_counts is distinct from v_new_counts
     or ((v_old_counts or v_new_counts)
         and (old.rating is distinct from new.rating
              or old.staff_id is distinct from new.staff_id)) then
    v_staff := array[old.staff_id, new.staff_id];
  end if;

  for v_id in select distinct s from unnest(v_staff) s loop
    perform recompute_staff_rating(v_id);
  end loop;

  return null;
end $$;

revoke all on function public.feedback_rating_hook() from public, anon, authenticated;

drop trigger if exists feedback_rating_hook on feedback;
create trigger feedback_rating_hook
  after insert or update or delete on feedback
  for each row execute function public.feedback_rating_hook();

-- ---------------------------------------------------------------------
-- The guard: §9.10's editing rules, whoever the caller is.
--
-- The admin_all policy lets the office UPDATE and DELETE any row, so
-- without this a client entry is read-only only for as long as nobody
-- calls PATCH /rest/v1/feedback. security invoker: it decides, it does
-- not write anything else.
--
-- It binds every role a request can arrive as — anon, authenticated and
-- service_role — which covers PostgREST, the office's server actions and
-- the security invoker RPCs below. The database owner is not bound: it
-- can drop this trigger in any case, and fixtures and maintenance run as
-- it (160_client_portal clears a fixture entry that way).
-- ---------------------------------------------------------------------
create or replace function public.feedback_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  if current_user not in ('anon', 'authenticated', 'service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    -- §1.7 v1: "the office redacts a name by … deleting it (client
    -- feedback, §9.10) if asked to" — after a removal, and only then.
    if old.author_kind = 'client'
       and not exists (select 1 from staff s where s.id = old.staff_id and s.removed_at is not null) then
      raise exception 'Client feedback is read-only. It can be deleted only to redact a name after the worker''s GDPR removal (§9.10, §1.7)'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.author_kind is distinct from old.author_kind
     or new.staff_id is distinct from old.staff_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'The kind, worker, author and date of a feedback entry are fixed. Delete it and add a new one instead'
      using errcode = '42501';
  end if;

  if old.author_kind = 'client' then
    if new.event_id is distinct from old.event_id
       or new.rating is distinct from old.rating
       or new.text is distinct from old.text then
      raise exception 'Client feedback is read-only: it cannot be edited (§9.10)' using errcode = '42501';
    end if;
    if old.read_at is not null
       and (new.read_at is distinct from old.read_at or new.read_by is distinct from old.read_by) then
      raise exception 'This entry has already been marked as read, and that is not undone (§9.10)'
        using errcode = '42501';
    end if;
  elsif new.rating is distinct from old.rating
     or new.text is distinct from old.text
     or new.event_id is distinct from old.event_id then
    -- The office row prints "edited 19 Sep" from this (§1.7's redaction
    -- trail on the wireframe).
    new.updated_at := now();
  end if;

  return new;
end $$;

revoke all on function public.feedback_guard() from public, anon;

drop trigger if exists feedback_guard on feedback;
create trigger feedback_guard
  before update or delete on feedback
  for each row execute function public.feedback_guard();

-- =====================================================================
-- 4c · the RPCs the office calls
--
-- All security invoker: the admin_all policy on `feedback` is the gate,
-- as it is for every other office write (roles, venues, the profile).
-- A client or a worker reaches them, finds nothing to read, and is told
-- the entry or the worker does not exist.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mark as read. Idempotent: two managers working the same inbox will
-- both press it, and the second one is not an error — the first name
-- and time stay on the row.
-- ---------------------------------------------------------------------
create or replace function public.mark_feedback_read(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_row feedback%rowtype;
begin
  select * into v_row from feedback where id = p_id for update;
  if not found then
    raise exception 'unknown_feedback' using errcode = 'P0002';
  end if;
  if v_row.author_kind <> 'client' then
    raise exception 'Only client feedback is marked as read: an office entry counts from submission (§9.10)'
      using errcode = '22023';
  end if;

  if v_row.read_at is null then
    update feedback
       set read_at = now(), read_by = (select auth.uid())
     where id = p_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'readAt', v_row.read_at,
    'staffId', v_row.staff_id,
    'rating', (select rating from staff where id = v_row.staff_id));
end $$;

comment on function public.mark_feedback_read(uuid) is
  '§9.10 Mark as read: the client entry starts counting toward the worker''s rating (§6) from this moment. Idempotent; the first reader is kept.';

-- ---------------------------------------------------------------------
-- An office entry must name the event only if it is tied to one, and
-- then it has to be an event the worker was booked on — the dropdown
-- offers only those, and this is the same rule from the other side.
-- ---------------------------------------------------------------------
create or replace function public.feedback_event_is_the_workers(p_staff uuid, p_event uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select p_event is null
      or exists (select 1
                   from bookings b
                   join shift_requirements sr on sr.id = b.shift_id
                  where b.staff_id = p_staff and sr.event_id = p_event)
$$;

revoke all on function public.feedback_event_is_the_workers(uuid, uuid) from public, anon;

create or replace function public.add_office_feedback(
  p_staff  uuid,
  p_rating int,
  p_text   text,
  p_event  uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to leave feedback' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;
  if v_text is null then
    raise exception 'A comment is required' using errcode = '22023';
  end if;
  if not exists (select 1 from staff where id = p_staff) then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if exists (select 1 from staff where id = p_staff and removed_at is not null) then
    raise exception 'This worker has been removed (§1.7); no new feedback can be added'
      using errcode = '22023';
  end if;
  if not feedback_event_is_the_workers(p_staff, p_event) then
    raise exception 'That worker was not booked on that event' using errcode = '22023';
  end if;

  -- author_id is the caller, never a parameter: §9.10 prints the
  -- manager's own name on the entry, so it has to be theirs.
  insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
  values ('office', (select auth.uid()), p_staff, p_event, p_rating, v_text)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.add_office_feedback(uuid, int, text, uuid) is
  '§9.10 office feedback: stars + comment from the manager, optionally tied to an event the worker was booked on. The author is the caller. Counts toward the rating immediately.';

create or replace function public.update_office_feedback(
  p_id     uuid,
  p_rating int,
  p_text   text,
  p_event  uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_row  feedback%rowtype;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  select * into v_row from feedback where id = p_id for update;
  if not found then
    raise exception 'unknown_feedback' using errcode = 'P0002';
  end if;
  if v_row.author_kind <> 'office' then
    raise exception 'Client feedback is read-only: it cannot be edited (§9.10)' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;
  if v_text is null then
    raise exception 'A comment is required' using errcode = '22023';
  end if;
  if not feedback_event_is_the_workers(v_row.staff_id, p_event) then
    raise exception 'That worker was not booked on that event' using errcode = '22023';
  end if;

  update feedback
     set rating = p_rating, text = v_text, event_id = p_event
   where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'staffId', v_row.staff_id,
    'rating', (select rating from staff where id = v_row.staff_id));
end $$;

comment on function public.update_office_feedback(uuid, int, text, uuid) is
  '§9.10: office entries can be edited after submission, from /feedback and from the worker''s profile. The author and the date stay; updated_at records the edit.';

create or replace function public.delete_feedback(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_staff uuid;
begin
  -- feedback_guard() refuses a client entry unless the worker has been
  -- removed, so the rule lives in one place and holds for REST too.
  delete from feedback where id = p_id returning staff_id into v_staff;
  if v_staff is null then
    raise exception 'unknown_feedback' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', p_id,
    'staffId', v_staff,
    'rating', (select rating from staff where id = v_staff));
end $$;

comment on function public.delete_feedback(uuid) is
  '§9.10: an office entry can be deleted at any time; a client entry only after the worker''s GDPR removal, to redact a name if asked (§1.7).';

revoke all on function public.mark_feedback_read(uuid) from public, anon;
revoke all on function public.add_office_feedback(uuid, int, text, uuid) from public, anon;
revoke all on function public.update_office_feedback(uuid, int, text, uuid) from public, anon;
revoke all on function public.delete_feedback(uuid) from public, anon;
grant execute on function public.mark_feedback_read(uuid) to authenticated;
grant execute on function public.add_office_feedback(uuid, int, text, uuid) to authenticated;
grant execute on function public.update_office_feedback(uuid, int, text, uuid) to authenticated;
grant execute on function public.delete_feedback(uuid) to authenticated;
grant execute on function public.feedback_event_is_the_workers(uuid, uuid) to authenticated;

-- =====================================================================
-- 5 · feedback_entries_v — what /feedback and the profile tab read
--
-- Owner rights, with the admin test in the body (ADR-0016). §9.10 prints
-- the author by name — "the manager's own name, not a generic Office
-- label" — and the portal user's name on a client entry. Both live in
-- `profiles`, whose only policy is profiles_self (010_rls_admin pins that
-- as a known gap). A security_invoker view would therefore name the
-- signed-in manager and print NULL for every colleague, which is exactly
-- the generic label §9.10 rules out. The alternative, an admin policy on
-- `profiles`, widens every other surface at once and is not this
-- screen's to decide.
--
-- So the view names its columns, reads only what the two screens print,
-- and returns nothing to a caller who is not an admin — the same shape
-- ADR-0004 gave the client views, with the opposite role in the test.
-- =====================================================================
drop view if exists feedback_entries_v;
create view feedback_entries_v with (security_barrier = true) as
select
  f.id,
  f.author_kind,
  f.rating,
  f.text,
  f.created_at,
  f.updated_at,
  f.read_at,
  rb.full_name                                              as read_by_name,
  f.author_kind = 'client' and f.read_at is null            as unread,
  feedback_counts(f.author_kind, f.read_at)                 as counts_toward_rating,
  -- §9.10's editing rules, as the screen needs them. feedback_guard()
  -- enforces the same two facts.
  f.author_kind = 'office'                                  as editable,
  f.author_kind = 'office' or s.removed_at is not null      as deletable,
  f.author_id,
  au.full_name                                              as author_name,
  f.staff_id,
  -- §1.7's one name for a removed worker.
  case
    when s.removed_at is not null then deleted_account_label(s.employee_id)
    else s.first_name || ' ' || s.last_name
  end                                                       as staff_name,
  s.employee_id,
  s.removed_at is not null                                  as staff_removed,
  s.removed_at                                              as staff_removed_at,
  f.event_id,
  ev.title                                                  as event_title,
  ev.event_date,
  ev.venue_name,
  cl.id                                                     as client_id,
  cl.name                                                   as client_name,
  -- What the worker was there as (the wireframe's "· Waiting Staff").
  (select string_agg(distinct r.name, ', ' order by r.name)
     from bookings b
     join shift_requirements sr on sr.id = b.shift_id
     join roles r on r.id = sr.role_id
    where b.staff_id = f.staff_id and sr.event_id = f.event_id) as role_names
from feedback f
join staff s on s.id = f.staff_id
left join events ev on ev.id = f.event_id
left join clients cl on cl.id = ev.client_id
left join profiles au on au.id = f.author_id
left join profiles rb on rb.id = f.read_by
where current_app_role() = 'admin';

comment on view feedback_entries_v is
  '§9.10 feedback, one row per entry, for /feedback and the §9.6 Feedback tab. Owner rights with current_app_role() = ''admin'' in the body (ADR-0016): the author and reader are named from profiles, which admins cannot read directly. Anyone else gets no rows. No money, no contact details.';

revoke all on feedback_entries_v from public, anon, authenticated;
grant select on feedback_entries_v to authenticated;

-- The office tab's "All authors" filter: every manager who has written
-- an entry, named. Same reasoning, same shape.
drop view if exists feedback_authors_v;
create view feedback_authors_v with (security_barrier = true) as
select distinct f.author_id, p.full_name as author_name
  from feedback f
  join profiles p on p.id = f.author_id
 where f.author_kind = 'office'
   and current_app_role() = 'admin';

comment on view feedback_authors_v is
  'The /feedback office tab''s author filter (§9.10). Owner rights, admin only (ADR-0016).';

revoke all on feedback_authors_v from public, anon, authenticated;
grant select on feedback_authors_v to authenticated;

-- ---------------------------------------------------------------------
-- staff_feedback_v (20260922094500) inner-joined `events`, which would
-- now drop every office entry that is not tied to one. Same columns,
-- outer joins; still security_invoker. The screens read
-- feedback_entries_v; this stays correct for anything else that does.
-- ---------------------------------------------------------------------
create or replace view staff_feedback_v with (security_invoker = true) as
select
  f.id,
  f.staff_id,
  f.author_kind,
  case
    when f.author_kind = 'office' then p.full_name
    else cl.name
  end                                                        as author_name,
  f.rating,
  f.text,
  f.read_at,
  f.author_kind = 'office' or f.read_at is not null          as counts_toward_rating,
  f.created_at,
  f.updated_at,
  ev.id                                                      as event_id,
  ev.title                                                   as event_title,
  ev.event_date
from feedback f
left join events ev on ev.id = f.event_id
left join clients cl on cl.id = ev.client_id
left join profiles p on p.id = f.author_id;

-- =====================================================================
-- 6 · the client's direct INSERT, narrowed
--
-- The portal writes through submit_client_feedback() (definer), but the
-- policy from 0001 is still there and 001_rls_guard / 020_rls_client
-- rely on it. As written it let a customer insert a row with `read_at`
-- already set — counted, with no Mark as read — and under anyone's
-- author_id. With the rating hook above that is a customer moving a
-- worker's score directly. The row must arrive unread, as its author.
-- =====================================================================
drop policy if exists client_feedback_insert on feedback;
create policy client_feedback_insert on feedback for insert with check (
  current_app_role() = 'client'
  and author_kind = 'client'
  and author_id = (select auth.uid())
  and read_at is null
  and read_by is null
  and exists (select 1 from events e where e.id = event_id and e.client_id = current_client_id())
);

-- =====================================================================
-- Backfill: every worker who already has a counted entry is brought into
-- line with it now. A worker with none keeps the rating they have (the
-- seed's, or anything carried over from before this platform) until
-- their first counted entry arrives — from then on it is derived.
-- =====================================================================
do $$
declare
  v_staff uuid;
begin
  for v_staff in
    select distinct staff_id from feedback where feedback_counts(author_kind, read_at)
  loop
    perform recompute_staff_rating(v_staff);
  end loop;
end $$;
