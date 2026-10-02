-- =====================================================================
-- Message one worker from their profile — ADR-0081
--
-- The owner: "We should be able to push notify individual staff as well."
-- ADR-0069 messages the people on an event — the whole line-up, one role,
-- or one person booked on it. Its "Not done" left out a message from a
-- worker's profile and a message to someone who is not on an event. This
-- is that: Send push on /staff/:id, the manager's own words to that one
-- worker, whatever they are or are not booked on.
--
-- send_staff_message(p_staff, p_message) queues one OM2 push through
-- notification_outbox, keyed per message, and answers like
-- send_event_message(): `sent`, and `withoutPush` — the worker's name
-- when they have no push subscription, so the manager knows to phone.
--
-- Who may be messaged: anyone with a staff row who has not been removed
-- (§1.7 — the person no longer exists to us). A candidate or a leaver can
-- be messaged: the database cannot tell what the office needs to say, and
-- one without the app simply comes back in `withoutPush`.
--
-- Refusals: staff_not_found (raised) · staff_removed · message_required ·
-- message_too_long. Admin only, not a viewer (ADR-0060), as ADR-0069.
--
-- audit_log: `staff.message_sent` on the worker, with the text, so it shows
-- in the profile's History tab. GDPR removal already scrubs the worker's
-- outbox rows by recipient (20260930120100); the trigger below drops the
-- typed text from these audit rows too, because a message written TO one
-- person is about them in a way a line-up message is not.
-- =====================================================================

create or replace function public.send_staff_message(
  p_staff uuid,
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
  s            staff;
  v_no_push    jsonb := '[]'::jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- A viewer (ADR-0060) changes nothing; a push is a write the worker sees.
  perform assert_not_read_only();

  select * into s from staff where id = p_staff;
  if s.id is null then raise exception 'staff_not_found' using errcode = 'P0002'; end if;

  if s.status = 'removed' or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'staff_removed');
  end if;
  if v_message is null then
    return jsonb_build_object('ok', false, 'reason', 'message_required');
  end if;
  if char_length(v_message) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'message_too_long');
  end if;

  -- The key is new per message, so nothing here can collide with an
  -- earlier send.
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('OM2:' || v_message_id,
          'push', 'OM2', s.id,
          jsonb_build_object('message',   v_message,
                             'messageId', v_message_id::text));

  if not exists (select 1 from push_subscriptions p where p.staff_id = s.id) then
    v_no_push := jsonb_build_array(btrim(s.first_name || ' ' || s.last_name));
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.message_sent', 'staff', s.id,
          jsonb_build_object('messageId', v_message_id, 'message', v_message, 'sent', 1));

  return jsonb_build_object('ok', true, 'sent', 1, 'withoutPush', v_no_push,
                            'messageId', v_message_id);
end $$;

comment on function public.send_staff_message(uuid, text) is
  'ADR-0081: the office messages one worker from their profile. Queues one OM2 push with the manager''s text (1–300 characters) in the payload, whatever the worker is booked on. Returns sent, and withoutPush: the worker''s name when they have no push subscription, for the manager to phone. Refusals: staff_removed / message_required / message_too_long; staff_not_found raised. Admin only, not a viewer. Writes staff.message_sent to audit_log.';

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone leaves anon open (docs/14 O7).
revoke execute on function public.send_staff_message(uuid, text) from public, anon;
grant execute on function public.send_staff_message(uuid, text) to authenticated;

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
  '§1.7 GDPR removal for ADR-0081: drops the office''s typed text from the worker''s staff.message_sent audit rows, keeping that a message was sent and by whom. The OM2 outbox rows are scrubbed by remove_worker() (20260930120100) by recipient. Fires once, after removed_at is first set. A trigger function: not an RPC.';

-- Trigger functions are never RPCs (20260927161000, pgTAP 190).
revoke execute on function public.staff_removed_scrub_messages() from public, anon, authenticated;
