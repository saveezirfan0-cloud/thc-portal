-- =====================================================================
-- The account invitation email (E11) and the office inbox (ADR-0038)
-- §1.4 logins, §8 register, §9.12 senders, §1.8 audit stamps
--
-- ADR-0035 decision 3 showed a Back Office or Client Portal login's
-- one-time set-up link on /users instead of emailing it, because an email
-- is a new entry in the §8 register and that is the contract's to add.
-- THC has approved it: the register gains E11 (packages/notifications,
-- the next free E-number after E10), and this is its write path.
--
-- 1 · queue_account_invite(p_user, p_link)
--     The office's server action mints the link (GoTrue generateLink, the
--     service key's one job) and registers the login as the manager
--     (admin_register_account). It then calls this, still as the manager,
--     to email the link to the person. Everything is decided here:
--
--       * admin only — `current_app_role() = 'admin'`, the same check
--         every /users function makes;
--       * never a staff login: a worker's link is E3, made by Accept
--         (§2.4, §2.7) with its own resend rules;
--       * never a login that is switched off, or one that has ever been
--         signed in to (ADR-0035 3a: its owner uses Forgot password);
--       * the link must be a set-up link — https (or http on 127.0.0.1 /
--         localhost, for a local stack), path /auth/invite, a token in the
--         query and nothing that could reshape it — because the function
--         puts THC's name and the admin@ sender on whatever it is given;
--       * the ADDRESS and the NAME are read here, from auth.users and
--         profiles, never taken from the caller, so this door cannot send
--         THC-branded mail to an arbitrary address (the reason
--         queue_office_notifications refuses emails, 20260922170000).
--
--     Keys are E11:invite:<user>:<n>, n counting that login's invite
--     emails. So:
--       * a re-sent invite (a new link) is a new row, n + 1;
--       * the same link twice — a double-click, a retried request — finds
--         the row already carrying it and queues nothing;
--       * an older E11 for the same login that has not gone yet is failed
--         with "superseded": minting the new link replaced its token, and
--         an email whose link cannot work is worse than no email. (E3's
--         resend rewrites the older row's link instead; here the new row
--         already exists, and two emails with one link would be one too
--         many.)
--     The profile row is locked first, so two calls for one login are
--     serialised and cannot both take the same n.
--
--     `payload` is the VALUES map the drain renders E11's copy with
--     (`messageFor()`), never rendered text: app, name, link. 652 and the
--     register's own test hold the two lists together.
--
--     The audit row ('account.invite_emailed') names the outbox key, the
--     address and the app — never the link, which is a credential until it
--     is used or expires.
--
-- 2 · notification_outbox.queued_at
--     /inbox shows when each office email was queued, and filters by
--     period. The table had no creation stamp: `send_after` moves on every
--     claim and retry. Existing rows are backfilled with the earliest stamp
--     they carry, which is the queue time for every row sent or failed on
--     its first attempt and within the backoff of it otherwise.
--     /inbox reads the table directly under its existing admin_read policy
--     (001_rls_guard assertion 8 is unchanged); no new policy, no new read
--     function — the rows need no join, the payload carries the names.
--
-- Forward-only; nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · notification_outbox.queued_at
-- ---------------------------------------------------------------------
alter table notification_outbox add column if not exists queued_at timestamptz;

update notification_outbox
   set queued_at = least(send_after, sent_at, failed_at, last_attempt_at)
 where queued_at is null;

alter table notification_outbox
  alter column queued_at set default now(),
  alter column queued_at set not null;

comment on column notification_outbox.queued_at is
  'When the row was queued. Set by default on insert and never changed (send_after moves on every claim and retry). Rows older than 20260930120000 carry the earliest stamp they had. Read by /inbox (ADR-0038).';

create index if not exists notification_outbox_template_id_idx
  on notification_outbox (template, id desc);

-- ---------------------------------------------------------------------
-- 2 · account_invite_link_ok — is this a set-up link, and nothing else?
-- ---------------------------------------------------------------------
-- The token half is ACTIVATION_TOKEN_PATTERN from packages/db/activation.ts
-- (GoTrue's hashed token, 56 hex today, wider on purpose). Query values are
-- limited to unreserved characters and percent-escapes, so no fragment, no
-- space and no second URL can ride along. The host admits no userinfo
-- (`user@host`), which would make the visible host a lie.
create or replace function public.account_invite_link_ok(p_link text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    char_length(p_link) <= 2048
    and p_link ~ (
      '^(https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?'
      || '|http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?)'
      || '/auth/invite\?'
      || '([A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*&)*'
      || 'token=[A-Za-z0-9_-]{32,200}'
      || '(&[A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*)*$'),
    false)
$$;

comment on function public.account_invite_link_ok(text) is
  'E11 (ADR-0038): true when the text is a Back Office / Client Portal set-up link — https (or http on 127.0.0.1/localhost), path /auth/invite, a GoTrue hashed token in the query, nothing else that could reshape it.';

-- ---------------------------------------------------------------------
-- 3 · queue_account_invite
-- ---------------------------------------------------------------------
create or replace function public.queue_account_invite(p_user uuid, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_link       text := btrim(coalesce(p_link, ''));
  v_profile    profiles;
  v_email      text;
  v_banned     timestamptz;
  v_signed_in  timestamptz;
  v_app        text;
  v_name       text;
  v_prefix     text;
  v_existing   text;
  v_n          int;
  v_key        text;
  v_superseded int;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not account_invite_link_ok(v_link) then
    raise exception 'invite_link_invalid' using errcode = '22023';
  end if;

  -- Locked first: two calls for one login queue one after the other.
  select * into v_profile from profiles where id = p_user for update;
  select u.email::text, u.banned_until, u.last_sign_in_at
    into v_email, v_banned, v_signed_in
    from auth.users u where u.id = p_user;
  if v_profile.id is null or nullif(btrim(coalesce(v_email, '')), '') is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  -- A worker's set-up link is E3, from Accept (§2.4, §2.7).
  if v_profile.role not in ('admin', 'client')
     or exists (select 1 from staff s where s.user_id = p_user) then
    raise exception 'role_not_allowed' using errcode = 'P0001';
  end if;
  if v_banned is not null and v_banned > now() then
    raise exception 'login_disabled' using errcode = 'P0001';
  end if;
  -- ADR-0035 3a: a login in use gets no link; its owner resets their own.
  if v_signed_in is not null then
    raise exception 'already_signed_in' using errcode = 'P0001';
  end if;

  v_prefix := 'E11:invite:' || p_user::text || ':';

  -- The same link again: the row that already carries it, and nothing new.
  select o.key into v_existing
    from notification_outbox o
   where o.template = 'E11'
     and left(o.key, char_length(v_prefix)) = v_prefix
     and o.payload ->> 'link' = v_link
   order by o.id desc
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('queued', false, 'outboxKey', v_existing, 'email', v_email);
  end if;

  select count(*)::int + 1 into v_n
    from notification_outbox o
   where o.template = 'E11' and left(o.key, char_length(v_prefix)) = v_prefix;
  v_key := v_prefix || v_n::text;

  -- An older link still waiting cannot work any more: withdraw its email.
  update notification_outbox o
     set failed_at = now(),
         error = 'superseded: a newer set-up link was issued (' || v_key || ')'
   where o.template = 'E11'
     and left(o.key, char_length(v_prefix)) = v_prefix
     and o.sent_at is null and o.failed_at is null;
  get diagnostics v_superseded = row_count;

  v_app  := case v_profile.role when 'admin' then 'Back Office' else 'Client Portal' end;
  v_name := coalesce(nullif(split_part(btrim(coalesce(v_profile.full_name, '')), ' ', 1), ''), 'there');

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'E11', array[lower(btrim(v_email))],
          jsonb_build_object('app', v_app, 'name', v_name, 'link', v_link));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor, 'account.invite_emailed', 'account', p_user,
          jsonb_build_object('outboxKey', v_key, 'n', v_n, 'email', v_email, 'app', v_app,
                             'superseded', v_superseded));

  return jsonb_build_object('queued', true, 'outboxKey', v_key, 'n', v_n, 'email', v_email,
                            'superseded', v_superseded);
end;
$$;

comment on function public.queue_account_invite(uuid, text) is
  'E11 (ADR-0038): emails a Back Office or Client Portal login its one-time set-up link, from the admin sender, to the address on the login. Admin only; refuses staff, switched-off and already-used logins and anything that is not an /auth/invite link with a token. Key E11:invite:<user>:<n> — a new link is a new row, the same link twice is one; an older unsent E11 for the login is failed as superseded. Audited as account.invite_emailed, never with the link.';

-- ---------------------------------------------------------------------
-- 4 · Grants. PUBLIC gets nothing by default (190_job_function_grants 2f)
-- ---------------------------------------------------------------------
revoke all on function public.account_invite_link_ok(text)          from public, anon;
revoke all on function public.queue_account_invite(uuid, text)       from public, anon;
grant execute on function public.account_invite_link_ok(text)       to authenticated;
grant execute on function public.queue_account_invite(uuid, text)    to authenticated;
