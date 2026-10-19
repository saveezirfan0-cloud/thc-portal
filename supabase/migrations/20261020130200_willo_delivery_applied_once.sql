-- =====================================================================
-- Migration 20261020130200 · a Willo delivery is applied once (ADR-0164;
--                            security audit L2; §2.4, ADR-0066)
--
-- Willo signs nothing; the webhook's secret is a token in the address
-- (ADR-0066). Anyone who captures one delivery (an edge log, a proxy, a
-- shared screenshot of Willo's webhook page) can post it again. The state
-- machine made a repeat of the SAME step a no-op, but not a repeat later:
-- a captured "rejected" replayed after the office had reset the candidate
-- rejected them again, and a captured "progress" rewrote the answer count.
--
-- 1 · willo_deliveries — one row per delivery that was APPLIED: its key,
--     the candidate key and event it carried, the worker it moved, when.
--     The key is the receiver's (willoDeliveryKey, packages/db/src/willo.ts):
--     `sha256:<hex of the raw body>`. Willo's own id field is not used: its
--     path in the payload is still unconfirmed (ADR-0021, ADR-0066) and the
--     body's `id` may be the participant's, which would merge every event
--     of one candidate into one. A byte-identical body is the same delivery.
--     RLS: admin_read (the Back Office never needs it, but every table
--     carries a policy, 001 assertion 7), the office_read_only guard
--     (ADR-0060), written only by willo_record_event(). Kept 180 days
--     (20261020130300's outbox-purge job).
-- 2 · willo_record_event(…, p_delivery_key): restated from the live body
--     (pg_get_functiondef, 19.10.2026; identical to 20260923110000's) with
--     one addition at the top, after the candidate's row is locked: a key
--     already recorded answers {outcome: duplicate} and changes nothing;
--     otherwise the key is recorded IN THE SAME TRANSACTION as the change,
--     so a delivery that fails (5xx, Willo retries) leaves no key and its
--     retry still applies. A refusal (raise) rolls the key back with it.
--     The old four-argument function is dropped: two of the same name
--     with defaults would make `willo_record_event('W-1', 'x')` ambiguous.
--     A caller that passes no key (the office's own paths, pgTAP) is
--     treated as before.
-- 3 · willo_accept_with_account(…, p_delivery_key): restated from the live
--     body, passing the key through. A key already recorded is a repeat:
--     the token minted for this call is the live one now, so the unsent E3
--     is pointed at it (activation_link_refresh, as the body's own "another
--     delivery got here first" branch does) and nothing else happens.
-- 4 · willo_delivery_seen(p_key): asked by the receiver BEFORE it mints a
--     login or a token for an Accept, so a replay never kills the
--     candidate's current activation link.
--
-- The receiver also refuses a delivery whose own time (occurred_at /
-- created_at / timestamp) is older than WILLO_MAX_EVENT_AGE_HOURS (default
-- 168), and checks WILLO_TIMESTAMP_HEADER on the token path as well when it
-- is set (supabase/functions/willo-webhook). pgTAP 897.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The table
-- ---------------------------------------------------------------------
create table if not exists public.willo_deliveries (
  delivery_key        text primary key check (char_length(delivery_key) between 8 and 200),
  willo_candidate_id  text not null,
  event               text not null,
  staff_id            uuid references public.staff(id) on delete set null,
  applied_at          timestamptz not null default now()
);

comment on table public.willo_deliveries is
  'ADR-0164: every Willo webhook delivery that was applied, by its receiver key (sha256 of the raw body). A repeat is a no-op (willo_record_event). Written only by willo_record_event(); admin_read; kept 180 days.';

create index if not exists willo_deliveries_staff_id_idx on public.willo_deliveries (staff_id);
create index if not exists willo_deliveries_applied_at_idx on public.willo_deliveries (applied_at);

alter table public.willo_deliveries enable row level security;

drop policy if exists admin_read on public.willo_deliveries;
create policy admin_read on public.willo_deliveries
  for select using ((select current_app_role()) = 'admin');

drop trigger if exists office_read_only on public.willo_deliveries;
create trigger office_read_only before insert or update or delete or truncate
  on public.willo_deliveries
  for each statement execute function public.office_read_only_guard();

revoke all on public.willo_deliveries from public, anon, authenticated;
grant select on public.willo_deliveries to authenticated;
grant all on public.willo_deliveries to service_role;

-- ---------------------------------------------------------------------
-- 2 · willo_record_event, with the key
-- ---------------------------------------------------------------------
drop function if exists public.willo_record_event(text, text, timestamptz, jsonb);

create or replace function public.willo_record_event(
  p_willo_candidate_id text,
  p_event text,
  p_at timestamptz default now(),
  p_details jsonb default '{}'::jsonb,
  p_delivery_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  v_target text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_key text := nullif(btrim(coalesce(p_delivery_key, '')), '');
  v_new int;
begin
  select * into s from staff
   where willo_candidate_id = p_willo_candidate_id and removed_at is null
   for update;
  if s.id is null then
    raise exception 'unknown_willo_candidate' using errcode = 'P0002';
  end if;

  -- 20261020130200 (ADR-0164): one delivery, applied once. Recorded in the
  -- same transaction as whatever it changes, after the candidate's lock, so
  -- two copies arriving together queue here and the second finds the key.
  if v_key is not null then
    insert into willo_deliveries (delivery_key, willo_candidate_id, event, staff_id)
    values (left(v_key, 200), p_willo_candidate_id, coalesce(p_event, ''), s.id)
    on conflict (delivery_key) do nothing;
    get diagnostics v_new = row_count;
    if v_new = 0 then
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'duplicate');
    end if;
  end if;

  -- Progress is tracking only and never moves a card.
  if p_event = 'progress' then
    update staff
       set willo_answers_done = coalesce((v_details ->> 'answersDone')::int, willo_answers_done),
           willo_answers_total = coalesce((v_details ->> 'answersTotal')::int, willo_answers_total)
     where id = s.id;
    return jsonb_build_object('staffId', s.id::text, 'outcome', 'tracked');
  end if;

  v_target := (select value ->> p_event from settings where key = 'willo_stage_map');

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_at, null, 'willo_event', 'staff', s.id,
          jsonb_build_object('event', p_event, 'target', v_target, 'fromStatus', s.status::text));

  if v_target is null then
    return jsonb_build_object('staffId', s.id::text, 'outcome', 'ignored');
  end if;

  -- Idempotent: Willo retries webhooks, and a repeat of an event already
  -- applied must be a no-op rather than an illegal-transition error.
  if v_target = 'interview_completed' then
    if s.status = 'interview_requested' then
      update staff
         set status = 'interview_completed',
             willo_completed_at = p_at,
             willo_answers_done = coalesce((v_details ->> 'answersDone')::int, willo_answers_total, willo_answers_done),
             willo_answers_total = coalesce((v_details ->> 'answersTotal')::int, willo_answers_total)
       where id = s.id;
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'interview_completed');
    end if;

  elsif v_target = 'documents' then
    if s.status = 'interview_requested' then
      -- A decision can arrive before, or instead of, the New Response
      -- event. The machine has no shortcut, so walk the edge.
      update staff set status = 'interview_completed', willo_completed_at = p_at where id = s.id;
      s.status := 'interview_completed';
    end if;
    if s.status = 'interview_completed' then
      perform onboarding_do_accept(s.id, 'willo', p_at,
                                   v_details ->> 'activationLink', v_details ->> 'installLink');
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'documents');
    end if;

  elsif v_target = 'rejected' then
    if s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract') then
      perform onboarding_do_reject(s.id, 'willo', 'Rejected in Willo', null, p_at);
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'rejected');
    end if;

  else
    raise exception 'unsupported_willo_mapping: % -> %', p_event, v_target using errcode = '22023';
  end if;

  return jsonb_build_object('staffId', s.id::text, 'outcome', 'unchanged', 'status', s.status::text);
end $$;

comment on function public.willo_record_event(text, text, timestamptz, jsonb, text) is
  '§2.4: apply one Willo webhook event to its candidate through settings.willo_stage_map (progress → answer counts; interview_completed; documents → onboarding_do_accept; rejected → onboarding_do_reject). Idempotent on a repeat of the same step, and, given p_delivery_key, on a repeat of the same DELIVERY at any later time: {outcome: duplicate} (willo_deliveries, 20261020130200, ADR-0164). Service role only.';

revoke execute on function public.willo_record_event(text, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant  execute on function public.willo_record_event(text, text, timestamptz, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- 3 · willo_accept_with_account, passing the key through
-- ---------------------------------------------------------------------
drop function if exists public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid);

create or replace function public.willo_accept_with_account(
  p_willo_candidate_id text,
  p_event text,
  p_at timestamptz,
  p_details jsonb,
  p_user uuid,
  p_delivery_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        staff;
  v_target text;
  v_link   text := coalesce(p_details, '{}'::jsonb) ->> 'activationLink';
  v_key    text := nullif(btrim(coalesce(p_delivery_key, '')), '');
begin
  if coalesce(v_link, '') !~ '/activate/[A-Za-z0-9_-]{32,}' then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;
  if p_user is null then
    raise exception 'account_required' using errcode = '22023';
  end if;

  select * into s from staff
   where willo_candidate_id = p_willo_candidate_id and removed_at is null
   for update;
  if s.id is null then
    raise exception 'unknown_willo_candidate' using errcode = 'P0002';
  end if;

  -- 20261020130200: a delivery already applied. The token minted for this
  -- call is the live one now; keep any unsent E3 pointing at it, and stop.
  if v_key is not null and exists (select 1 from willo_deliveries d where d.delivery_key = left(v_key, 200)) then
    perform activation_link_refresh(s.id, p_user, v_link);
    return jsonb_build_object('staffId', s.id::text, 'outcome', 'duplicate');
  end if;

  v_target := (select value ->> p_event from settings where key = 'willo_stage_map');

  if v_target = 'documents' and s.status in ('interview_requested', 'interview_completed') then
    perform link_staff_account(s.id, p_user);
    return willo_record_event(p_willo_candidate_id, p_event, coalesce(p_at, now()), p_details, v_key)
           || jsonb_build_object('userId', p_user::text);
  end if;

  -- Another delivery got here first (or the map changed in between). The
  -- token minted for THIS call is now the live one; keep any unsent E3
  -- pointing at it.
  perform activation_link_refresh(s.id, p_user, v_link);
  return willo_record_event(p_willo_candidate_id, p_event, coalesce(p_at, now()), p_details, v_key);
end $$;

comment on function public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid, text) is
  '§2.4 Willo Accept with the candidate''s login: link_staff_account, then willo_record_event (→ documents, E3 with the personal link). A delivery already applied (p_delivery_key in willo_deliveries) only re-points the unsent E3 at this call''s token (20261020130200, ADR-0164). Service role only.';

revoke execute on function public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid, text) from public, anon, authenticated;
grant  execute on function public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 4 · Asked before anything is minted
-- ---------------------------------------------------------------------
create or replace function public.willo_delivery_seen(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from willo_deliveries d
                  where d.delivery_key = left(nullif(btrim(coalesce(p_key, '')), ''), 200))
$$;

comment on function public.willo_delivery_seen(text) is
  'ADR-0164: true when this Willo delivery key was already applied. The receiver asks before it mints a login or a token, so a replay never kills a live activation link. Service role only.';

revoke execute on function public.willo_delivery_seen(text) from public, anon, authenticated;
grant  execute on function public.willo_delivery_seen(text) to service_role;
