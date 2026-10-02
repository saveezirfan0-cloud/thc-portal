-- =====================================================================
-- Message hand-picked workers — ADR-0082
--
-- The owner: "We should be able to push notify individual staff as well",
-- then "add that as well — several hand picked".
--
-- ADR-0069 messages the people on an event — the whole line-up, one role,
-- or one person booked on it. Its "Not done" left out a message from a
-- worker's profile and a message to people who are not on an event. This
-- is that: Send push on /staff/:id (one worker) and on the /staff
-- directory (the workers the manager ticked), the manager's own words,
-- whatever those people are or are not booked on.
--
-- send_staff_message(p_staff uuid[], p_message) queues one OM2 push per
-- worker through notification_outbox, keyed per message and worker, and
-- answers like send_event_message(): `sent`, and `withoutPush` — the names
-- of those with no push subscription, so the manager knows whom to phone.
-- The list is the manager's pick, so the database checks every id on it
-- and refuses the whole send rather than quietly dropping anyone.
--
-- Who may be messaged: anyone with a staff row who has not been removed
-- (§1.7 — the person no longer exists to us). A candidate or a leaver can
-- be messaged: the database cannot tell what the office needs to say, and
-- one without the app simply comes back in `withoutPush`.
--
-- Refusals: message_required · message_too_long · nobody_to_message ·
-- too_many_recipients (over 200: a hand-picked list, not a broadcast) ·
-- staff_removed; staff_not_found is raised. Admin only, not a viewer
-- (ADR-0060), as ADR-0069.
--
-- audit_log: `staff.message_sent` on EACH worker, with the text and the
-- message id (shared by everyone in one send), so it shows in each
-- profile's History tab. GDPR removal already scrubs the worker's outbox
-- rows by recipient (20260930120100, now 20261001205000); the trigger below drops the typed
-- text from these audit rows too, because a message written to a handful
-- of named people is about them in a way a line-up message is not.
-- =====================================================================

create or replace function public.send_staff_message(
  p_staff uuid[],
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_message    text := nullif(btrim(coalesce(p_message, '')), '');
  v_message_id uuid := gen_random_uuid();
  v_ids        uuid[];
  v_sent       int := 0;
  v_no_push    jsonb := '[]'::jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- A viewer (ADR-0060) changes nothing; a push is a write the worker sees.
  perform assert_not_read_only();

  if v_message is null then
    return jsonb_build_object('ok', false, 'reason', 'message_required');
  end if;
  if char_length(v_message) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'message_too_long');
  end if;

  -- Each worker once, however often the list names them.
  select coalesce(array_agg(distinct x), '{}') into v_ids
    from unnest(coalesce(p_staff, '{}')) x
   where x is not null;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'nobody_to_message');
  end if;
  if cardinality(v_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_recipients');
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from staff s where s.id = x)) then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from staff s where s.id = any (v_ids)
              and (s.status = 'removed' or s.removed_at is not null)) then
    return jsonb_build_object('ok', false, 'reason', 'staff_removed');
  end if;

  -- The key is new per message, so nothing here can collide with an
  -- earlier send.
  with recipients as (
    select s.id as staff_id, btrim(s.first_name || ' ' || s.last_name) as name
      from staff s
     where s.id = any (v_ids)
  ), inserted as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'OM2:' || v_message_id || ':' || r.staff_id,
           'push', 'OM2', r.staff_id,
           jsonb_build_object('message',   v_message,
                              'messageId', v_message_id::text)
      from recipients r
    returning 1
  )
  select (select count(*)::int from inserted),
         coalesce((select jsonb_agg(r.name order by r.name)
                     from recipients r
                    where not exists (select 1 from push_subscriptions p
                                       where p.staff_id = r.staff_id)), '[]'::jsonb)
    into v_sent, v_no_push;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  select now(), auth.uid(), 'staff.message_sent', 'staff', x,
         jsonb_build_object('messageId', v_message_id, 'message', v_message,
                            'recipients', v_sent)
    from unnest(v_ids) x;

  return jsonb_build_object('ok', true, 'sent', v_sent, 'withoutPush', v_no_push,
                            'messageId', v_message_id);
end $$;

comment on function public.send_staff_message(uuid[], text) is
  'ADR-0082: the office messages hand-picked workers — one from their profile, or several ticked in the Staff directory. Queues one OM2 push per worker with the manager''s text (1–300 characters) in the payload, whatever they are booked on. Returns sent, and withoutPush: the names of recipients with no push subscription, for the manager to phone. Refusals: message_required / message_too_long / nobody_to_message / too_many_recipients (over 200) / staff_removed; staff_not_found raised. Admin only, not a viewer. Writes staff.message_sent to audit_log on each worker.';

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone leaves anon open (docs/14 O7).
revoke execute on function public.send_staff_message(uuid[], text) from public, anon;
grant execute on function public.send_staff_message(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- §1.7: a removed worker's messages keep that they were sent, not what
-- they said. remove_worker() strips its known personal keys from the
-- worker's audit rows; the manager's free text is not one of them.
-- ---------------------------------------------------------------------
create or replace function public.staff_removed_scrub_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update audit_log l
     set data = l.data - 'message'
   where l.entity = 'staff'
     and l.entity_id = new.id
     and l.action = 'staff.message_sent'
     and l.data ? 'message';
  return null;
end $$;

drop trigger if exists staff_removed_scrub_messages on staff;
create trigger staff_removed_scrub_messages
  after update of removed_at on staff
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function staff_removed_scrub_messages();

comment on function public.staff_removed_scrub_messages() is
  '§1.7 GDPR removal for ADR-0082: drops the office''s typed text from the worker''s staff.message_sent audit rows (the other recipients'' rows keep it), keeping that a message was sent and by whom. The OM2 outbox rows are scrubbed by remove_worker() (20261001205000) by recipient. Fires once, after removed_at is first set. A trigger function: not an RPC.';

-- Trigger functions are never RPCs (20260927161000, pgTAP 190).
revoke execute on function public.staff_removed_scrub_messages() from public, anon, authenticated;
