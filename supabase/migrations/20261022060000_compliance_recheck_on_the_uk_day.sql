-- =====================================================================
-- Migration 20261022060000 · the §4.3 full re-check runs on the UK day
--
-- Rules are evaluated in Europe/London (§1.8). Two callers of the full
-- compliance re-check still asked it about `current_date`, which is the
-- day in the SESSION's time zone — UTC on Supabase:
--
--   compliance_docs_verified()  the trigger behind every Verify, which
--                               lifts an automatic block
--                               (unblock_if_compliant(new.staff_id))
--   unblock_worker()            the profile's Unblock, called with no
--                               p_on (its default was current_date)
--
-- Between 00:00 and 01:00 UK time in summer the UTC day is still the day
-- before, so a document that expires TODAY in the UK was not yet expired to
-- either of them: a Verify or an Unblock in that hour lifted the block of a
-- worker whose other document runs out that same day (and compliance_daily
-- re-blocked them at 05:00), while compliance_verify_document_as() — which
-- does use the UK day — reported the same blocker in its own answer. Any
-- session whose zone is not UTC moved the window further.
--
-- Both now ask about the UK day. Bodies restated from the live
-- definitions (20260927161100 and 20260927160400, checked against pg_get_functiondef on main), with
-- only that changed. create or replace keeps every grant and revoke.
-- =====================================================================

create or replace function public.compliance_docs_verified()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_kind block_kind;
  v_decl uuid;
begin
  if new.review_status = 'verified' and old.review_status is distinct from 'verified' then
    select block_kind into v_kind from staff where id = new.staff_id;
    -- 20261022060000: the UK day, never the session's current_date.
    if unblock_if_compliant(new.staff_id, (now() at time zone 'Europe/London')::date)
       and v_kind = 'conviction_review' then
      -- The accepted declaration whose re-check has only now passed:
      -- "your shifts are open again" was owed since Verify (§10.7).
      select c.id into v_decl
        from criminal_declarations c
       where c.staff_id = new.staff_id
         and c.source = 'in_employment'
         and c.review_status = 'verified'
         and not c.superseded
       order by c.reviewed_at desc nulls last, c.declared_at desc
       limit 1;
      if v_decl is not null then
        insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
        values ('N15:declaration:' || v_decl, 'push', 'N15', new.staff_id, '{}'::jsonb)
        on conflict (key) do nothing;
      end if;
    end if;
  end if;
  return new;
end $function$;

create or replace function public.unblock_worker(
  p_staff uuid,
  -- 20261022060000: the UK day by default (was current_date).
  p_on    date default ((now() at time zone 'Europe/London')::date),
  p_actor uuid default null::uuid
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v staff;
  v_reasons text[];
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status <> 'blocked' then
    raise exception 'not_blocked' using errcode = 'P0001';
  end if;

  select array_agg(reason order by reason) into v_reasons
    from compliance_blockers(p_staff, p_on);

  if v_reasons is not null then
    return jsonb_build_object('unblocked', false, 'blockers', to_jsonb(v_reasons));
  end if;

  perform assert_staff_transition(v.status, 'compliant'::staff_status);
  update staff set status = 'compliant', block_kind = null, block_reason = null
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), coalesce(p_actor, auth.uid()), 'unblock', 'staff', p_staff,
          jsonb_build_object('blockKind', v.block_kind::text,
                             'reason', v.block_reason,
                             'checkedOn', p_on));
  return jsonb_build_object('unblocked', true, 'blockers', '[]'::jsonb);
end $function$;
