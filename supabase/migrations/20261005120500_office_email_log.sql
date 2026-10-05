-- =====================================================================
-- 20261005120500 · The office email log (ADR-0086)
--
-- /inbox lists the emails the platform sent. Until now it read
-- notification_outbox directly and showed only the office and payroll
-- emails, because a candidate's or a worker's email can carry a one-time
-- set-up link (E3, E11, OC2) and three restrictive policies fence those
-- rows to owners. The office also needs to answer "did we email this
-- person?": the E2 rejection, the E3 activation, the OC1 video-interview
-- reminder, the E11 login invitation.
--
-- office_email_log() answers it without widening any table policy:
--   * Back Office only (current_app_role() = 'admin'); a worker, a client
--     and anon get no rows. It is read-only.
--   * It returns the recipient, the status and a WHITELIST of payload
--     values that fill the subject line (name, employee ID, event, ...).
--     It never returns `link`, `installLink`, `attachments`, `rate` or
--     any other payload key, and it strips any URL out of an error text.
--     So a set-up link cannot leave through it, and an owner-only fence
--     (E3, OC2, E11) still guards the link itself on the table.
--   * Whom the email went to: the row's recipient_staff_id, else the
--     worker its key names (E3:staff:<id>:…, OC2:staff:<id>:…,
--     E3:resend:<id>:n), else the application behind an E2 / E2b key,
--     else a staff record with that address. A removed (GDPR) profile is
--     "Deleted account #id" with no address.
--   * Search (p_search) matches the recipient addresses, the name and the
--     Employee ID, with LIKE wildcards escaped.
--
-- No table, policy or column changes: 001_rls_guard stays as it is.
-- =====================================================================

create or replace function public.office_email_log(
  p_templates text[] default null,
  p_status    text   default null,
  p_since     timestamptz default null,
  p_before    bigint default null,
  p_search    text   default null,
  p_limit     integer default 50
)
returns table (
  id                 bigint,
  key                text,
  template           text,
  staff_id           uuid,
  recipient_name     text,
  staff_status       text,
  staff_removed      boolean,
  recipient_emails   text[],
  payload            jsonb,
  queued_at          timestamptz,
  sent_at            timestamptz,
  failed_at          timestamptz,
  error              text,
  attempts           integer
)
language sql
stable
security definer
set search_path = public
as $$
  with picked as (
    select n.id, n.key, n.template, n.recipient_staff_id, n.recipient_emails, n.payload,
           coalesce(n.queued_at, n.send_after) as queued_at,
           n.sent_at, n.failed_at, n.error, n.attempts
      from notification_outbox n
     where current_app_role() = 'admin'
       and n.channel = 'email'
       and (p_templates is null or n.template = any (p_templates))
       and case p_status
             when 'sent'   then n.sent_at is not null and n.failed_at is null
             when 'failed' then n.failed_at is not null
             when 'queued' then n.sent_at is null and n.failed_at is null
             else true
           end
       and (p_since  is null or coalesce(n.queued_at, n.send_after) >= p_since)
       and (p_before is null or n.id < p_before)
  ), keyed as (
    select p.*,
           coalesce(
             p.recipient_staff_id,
             substring(p.key from ':staff:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)')::uuid,
             substring(p.key from '^E3:resend:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):')::uuid,
             (select a.staff_id from applications a
               where p.key ~ '^E2b?:application:'
                 and a.id::text = substring(p.key from ':application:([0-9a-f-]{36})$'))
           ) as named
      from picked p
  ), resolved as (
    -- The record the row names, if it exists; failing that the one that has
    -- the address the email went to.
    select k.*,
           coalesce(
             (select s1.id from staff s1 where s1.id = k.named),
             (select s2.id from staff s2
               where k.recipient_emails is not null
                 and lower(s2.email) = lower(k.recipient_emails[1])
               order by s2.id limit 1)
           ) as sid
      from keyed k
  )
  select r.id, r.key, r.template, s.id,
         case when s.id is null then null
              when s.removed_at is not null
                then 'Deleted account #' || coalesce(s.employee_id::text, left(s.id::text, 8))
              else btrim(s.first_name || ' ' || s.last_name) end,
         s.status::text,
         (s.removed_at is not null),
         case when s.removed_at is not null then null else r.recipient_emails end,
         coalesce((select jsonb_object_agg(e.key, e.value)
                     from jsonb_each(r.payload) e
                    where e.key = any (array['name', 'employeeId', 'event', 'role', 'date',
                                             'days', 'app', 'periodStart', 'periodEnd',
                                             'poSuffix', 'staffCount', 'variant', 'client'])
                      and jsonb_typeof(e.value) in ('string', 'number')),
                  '{}'::jsonb),
         r.queued_at, r.sent_at, r.failed_at,
         regexp_replace(r.error, 'https?://\S+', '[link removed]', 'g'),
         r.attempts
    from resolved r
    left join staff s on s.id = r.sid
   where nullif(btrim(p_search), '') is null
      -- A removed (GDPR) profile is found by its Employee ID only: its
      -- address and name are not searchable once it is anonymised.
      or (s.removed_at is null
          and (array_to_string(r.recipient_emails, ' ') ilike
                 '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
               or s.email ilike
                 '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
               or (s.first_name || ' ' || s.last_name) ilike
                 '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
               or (r.payload ->> 'name') ilike
                 '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'))
      or s.employee_id::text = btrim(p_search)
   order by r.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

comment on function public.office_email_log(text[], text, timestamptz, bigint, text, integer) is
  'ADR-0086, /inbox: the email-channel rows of notification_outbox for the Back Office (admin only), newest first. Recipient resolved to a staff record where one can be found; payload reduced to the values that fill the subject line (never a link); URLs stripped from errors. Read-only.';

revoke all on function public.office_email_log(text[], text, timestamptz, bigint, text, integer)
  from public, anon;
grant execute on function public.office_email_log(text[], text, timestamptz, bigint, text, integer)
  to authenticated;

-- The "N failed in this period" banner: the failures in the codes given,
-- not counting a send the office switched off on purpose (ADR-0083).
create or replace function public.office_email_failures(
  p_templates    text[],
  p_since        timestamptz default null,
  p_ignore_error text default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when current_app_role() = 'admin' then
    (select count(*)::int
       from notification_outbox n
      where n.channel = 'email'
        and n.template = any (p_templates)
        and n.failed_at is not null
        and (p_ignore_error is null or n.error is distinct from p_ignore_error)
        and (p_since is null or coalesce(n.queued_at, n.send_after) >= p_since))
  else 0 end;
$$;

comment on function public.office_email_failures(text[], timestamptz, text) is
  'ADR-0086, /inbox: how many emails of these codes failed since a time. Back Office only; 0 for anyone else.';

revoke all on function public.office_email_failures(text[], timestamptz, text) from public, anon;
grant execute on function public.office_email_failures(text[], timestamptz, text) to authenticated;
