-- =====================================================================
-- Migration 20261024120000 · Tickets: the team logs issues, requests and
--                            updates from the Back Office (ADR-0202)
--
-- The test run needs somewhere for the office to say "this is broken",
-- "can we have this" or "here is an update", that does not depend on
-- anybody remembering to write it down. A "Report" button in every Back
-- Office top bar opens a small form; the report becomes a ticket with a
-- number (TK-1, TK-2, …), arrives by email, and is followed up on
-- /tickets: status, severity and a thread of comments.
--
-- 1 · tickets          — one row per report. The number is the display
--                        id ("TK-12"); `id` stays the uuid the app uses.
-- 2 · ticket_comments  — the thread: office comments and the status /
--                        severity changes, in order, so a ticket's
--                        history reads top to bottom.
--     Both: RLS on, one admin_read policy, NO write grant to any API
--     role — every write is one of the three definer functions below
--     (the willo_deliveries / rtw_checks shape, 001 assertions 1 and 3).
--     Both carry the office_read_only statement trigger (ADR-0060): a
--     Viewer reads tickets and changes nothing, so reporting and
--     commenting are refused for a Viewer too (`read_only`) — the guard
--     keys on the session's user and would refuse the outbox insert inside
--     these functions anyway, and no function may be a way round it.
-- 3 · create_ticket()      — a Back Office login that may write. Saves the ticket and
--                            queues TK1 (variant `new`) to the addresses
--                            in settings.ticket_recipients. At most 20 a
--                            hour per login.
-- 4 · add_ticket_comment() — a Back Office login that may write. Queues TK1 (variant
--                            `comment`).
-- 5 · update_ticket()      — `write` only. Status and severity (`none`
--                            clears it); each change is a line in the
--                            thread, an optional note is a comment (and
--                            is emailed to settings.ticket_recipients),
--                            and a resolution note given with Resolved or
--                            Closed is kept and emailed to the REPORTER
--                            (their own sign-in address, read here).
--     assign_ticket(), set_ticket_kind() — the Owner and Category fields
--                            of the triage panel; `write` only; a line on
--                            the thread each. ticket_assignees() lists the
--                            logins the Owner picker offers.
--     delete_ticket()      — owners only, refused while time is logged.
--     add_ticket_comment() takes the kind of update: note, email, call,
--                            meeting or task.
--
-- 6 · ticket_scope, ticket_time — the owner's own tracking (internal, never
--     shown to the office): what each ticket is against the original scope
--     (fix, update, issue, against the scope, addition), set AFTER a ticket
--     is raised and never by the reporter; and the time spent on it, as a
--     start/stop timer or a manual entry, labelled owner / claude, with a
--     billable flag, for the month-end bill. Readable and writable only by
--     a "tracker": an Owner login, narrowed to the emails in
--     settings.ticket_tracking_emails when that list is not empty
--     (ticket_tracker_allowed()). The restriction is in the database, not
--     the screen: a manager's API call returns nothing.
--
-- Who gets the email. The register code TK1 pins no recipient (as CP2 and
-- CP3 do): the address is on the outbox row, read here from
-- settings.ticket_recipients — never from the caller — so no login can
-- point a THC-branded email at an address of their own (20260922170000).
-- Seeded with the product owner's address; an owner changes it in the
-- settings table without a release. A ticket is saved even if the list is
-- empty or unusable: the report is never lost for want of a mailbox.
--
-- No link in the email: the Back Office origin is not in the database
-- (20261012120500) and a link must not be taken from the caller.
-- pgTAP: supabase/tests/926_tickets.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · tickets
-- ---------------------------------------------------------------------
create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_no     bigint generated always as identity (start with 1) unique,
  kind          text not null default 'bug'
                  check (kind in ('bug', 'request', 'idea', 'update', 'question')),
  severity      text check (severity in ('low', 'medium', 'high', 'critical')),
  status        text not null default 'new'
                  check (status in ('new', 'in_progress', 'waiting', 'resolved', 'closed')),
  title         text not null check (char_length(title) between 3 and 200),
  details       text check (details is null or char_length(details) <= 5000),
  page_path     text check (page_path is null or char_length(page_path) <= 500),
  link_url      text check (link_url is null or (char_length(link_url) <= 500
                                                 and link_url ~* '^https?://[^\s]+$')),
  reporter_id   uuid references public.profiles(id) on delete set null,
  reporter_name text not null,
  assignee_id   uuid references public.profiles(id) on delete set null,
  assignee_name text,
  resolution    text check (resolution is null or char_length(resolution) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

comment on table public.tickets is
  'ADR-0202: a report logged from the Back Office (issue, request, idea, update, question), numbered TK-<ticket_no>. Written only by create_ticket() and update_ticket(); admin_read.';

create index if not exists tickets_status_created_idx on public.tickets (status, created_at desc);
create index if not exists tickets_created_idx on public.tickets (created_at desc);
create index if not exists tickets_reporter_id_idx on public.tickets (reporter_id);
create index if not exists tickets_assignee_id_idx on public.tickets (assignee_id);

-- ---------------------------------------------------------------------
-- 2 · ticket_comments
-- ---------------------------------------------------------------------
create table if not exists public.ticket_comments (
  id           bigint generated always as identity primary key,
  ticket_id    uuid not null references public.tickets(id) on delete cascade,
  kind         text not null default 'comment' check (kind in ('comment', 'change')),
  -- what sort of update a comment is: a note, an email, a call, a meeting or a task
  activity     text not null default 'note' check (activity in ('note', 'email', 'call', 'meeting', 'task')),
  body         text not null check (char_length(body) between 1 and 5000),
  author_id    uuid references public.profiles(id) on delete set null,
  author_name  text not null,
  created_at   timestamptz not null default now()
);

comment on table public.ticket_comments is
  'ADR-0202: the thread on a ticket — comments, and the status / severity changes as kind = change. Written only by add_ticket_comment() and update_ticket(); admin_read.';

create index if not exists ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);
create index if not exists ticket_comments_author_id_idx on public.ticket_comments (author_id);

-- ---------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;

drop policy if exists admin_read on public.tickets;
create policy admin_read on public.tickets
  for select using ((select current_app_role()) = 'admin');

drop policy if exists admin_read on public.ticket_comments;
create policy admin_read on public.ticket_comments
  for select using ((select current_app_role()) = 'admin');

revoke all on public.tickets, public.ticket_comments from public, anon, authenticated;
grant select on public.tickets, public.ticket_comments to authenticated;
grant all on public.tickets, public.ticket_comments to service_role;

-- ADR-0060: a Viewer changes nothing, through the API or a definer function.
drop trigger if exists office_read_only on public.tickets;
create trigger office_read_only before insert or update or delete or truncate
  on public.tickets
  for each statement execute function public.office_read_only_guard();

drop trigger if exists office_read_only on public.ticket_comments;
create trigger office_read_only before insert or update or delete or truncate
  on public.ticket_comments
  for each statement execute function public.office_read_only_guard();

-- ---------------------------------------------------------------------
-- Where the emails go
-- ---------------------------------------------------------------------
insert into public.settings (key, value)
values ('ticket_recipients', '["saveezirfan@gmail.com"]'::jsonb)
on conflict (key) do nothing;

-- Internal: the usable addresses in settings.ticket_recipients (lower-case,
-- trimmed, shaped like an address, no duplicates). Empty array when none.
create or replace function public.ticket_recipient_emails()
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct lower(btrim(e))), '{}'::text[])
    from public.settings s,
         lateral jsonb_array_elements_text(
           case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) e
   where s.key = 'ticket_recipients'
     and btrim(e) ~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$'
$$;

comment on function public.ticket_recipient_emails() is
  'ADR-0202: the addresses a ticket email goes to, from settings.ticket_recipients. Internal; not granted to any API role.';

revoke all on function public.ticket_recipient_emails() from public, anon, authenticated;
grant execute on function public.ticket_recipient_emails() to service_role;

-- ---------------------------------------------------------------------
-- 3 · create_ticket
-- ---------------------------------------------------------------------
create or replace function public.create_ticket(
  p_kind    text,
  p_severity text,
  p_title   text,
  p_details text default null,
  p_page    text default null,
  p_link    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind     text := coalesce(nullif(btrim(p_kind), ''), 'bug');
  v_severity text := nullif(btrim(coalesce(p_severity, '')), '');
  v_title    text := btrim(coalesce(p_title, ''));
  v_details  text := nullif(btrim(coalesce(p_details, '')), '');
  v_page     text := nullif(btrim(coalesce(p_page, '')), '');
  v_link     text := nullif(btrim(coalesce(p_link, '')), '');
  v_name     text;
  v_id       uuid;
  v_no       bigint;
  v_to       text[];
begin
  perform assert_office_caller();

  if char_length(v_title) < 3 then
    raise exception 'A one-line summary is required (at least 3 characters).' using errcode = '22023';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'The summary is at most 200 characters.' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 5000 then
    raise exception 'The details are at most 5,000 characters.' using errcode = '22023';
  end if;
  if v_kind not in ('bug', 'request', 'idea', 'update', 'question') then
    raise exception 'Choose what kind of report this is.' using errcode = '22023';
  end if;
  if v_severity is not null and v_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Choose how bad it is, or leave it blank.' using errcode = '22023';
  end if;
  if v_link is not null and (char_length(v_link) > 500 or v_link !~* '^https?://[^\s]+$') then
    raise exception 'The recording link must start with https:// and have no spaces.' using errcode = '22023';
  end if;

  -- A flood of reports is a flood of email to the owner.
  if (select count(*) from tickets t
       where t.reporter_id = auth.uid() and t.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many_tickets' using errcode = 'P0001',
      detail = 'At most 20 reports an hour from one login.';
  end if;

  v_name := coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()),
                     'Back Office user');

  insert into tickets (kind, severity, title, details, page_path, link_url, reporter_id, reporter_name)
  values (v_kind, v_severity, v_title, v_details, left(v_page, 500), v_link, auth.uid(), v_name)
  returning id, ticket_no into v_id, v_no;

  v_to := ticket_recipient_emails();
  if cardinality(v_to) > 0 then
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('TK1:ticket:' || v_id::text, 'email', 'TK1', v_to,
            jsonb_build_object(
              'variant',  'new',
              'ref',      'TK-' || v_no,
              'title',    v_title,
              'kind',     case v_kind when 'bug' then 'Bug' when 'request' then 'Request'
                            when 'idea' then 'Idea' when 'update' then 'Update'
                            else 'Question' end,
              'severity', case v_severity when 'low' then 'Low' when 'medium' then 'Medium'
                            when 'high' then 'High' when 'critical' then 'Critical'
                            else 'Not set' end,
              'reporter', v_name,
              'page',     coalesce(v_page, '—'),
              'link',     coalesce(v_link, '—'),
              'details',  coalesce(left(v_details, 3000), '(no details)')))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('id', v_id, 'number', v_no, 'ref', 'TK-' || v_no);
end $$;

comment on function public.create_ticket(text, text, text, text, text, text) is
  'ADR-0202: log a ticket (kind, optional severity, summary 3–200, details ≤ 5000, the page it was logged on, an optional recording link). Back Office logins only, a Viewer refused (read_only, ADR-0060); at most 20 an hour per login. Saves the ticket and queues TK1 (variant new, key TK1:ticket:<id>) to settings.ticket_recipients. Returns {id, number, ref}.';

revoke all on function public.create_ticket(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_ticket(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · add_ticket_comment
-- ---------------------------------------------------------------------
create or replace function public.add_ticket_comment(
  p_ticket   uuid,
  p_body     text,
  p_activity text default 'note'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t        tickets;
  v_body   text := btrim(coalesce(p_body, ''));
  v_act    text := coalesce(nullif(btrim(p_activity), ''), 'note');
  v_name   text;
  v_id     bigint;
  v_to     text[];
begin
  perform assert_office_caller();

  if v_body = '' then
    raise exception 'Write a comment first.' using errcode = '22023';
  end if;
  if v_act not in ('note', 'email', 'call', 'meeting', 'task') then
    raise exception 'Choose note, email, call, meeting or task.' using errcode = '22023';
  end if;
  if char_length(v_body) > 5000 then
    raise exception 'A comment is at most 5,000 characters.' using errcode = '22023';
  end if;

  select * into t from tickets where id = p_ticket for update;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;

  v_name := coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()),
                     'Back Office user');

  insert into ticket_comments (ticket_id, kind, activity, body, author_id, author_name)
  values (t.id, 'comment', v_act, v_body, auth.uid(), v_name)
  returning id into v_id;

  update tickets set updated_at = now() where id = t.id;

  v_to := ticket_recipient_emails();
  if cardinality(v_to) > 0 then
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('TK1:comment:' || v_id::text, 'email', 'TK1', v_to,
            jsonb_build_object(
              'variant',  'comment',
              'ref',      'TK-' || t.ticket_no,
              'title',    t.title,
              'status',   case t.status when 'new' then 'New' when 'in_progress' then 'In progress'
                            when 'waiting' then 'Waiting' when 'resolved' then 'Resolved'
                            else 'Closed' end,
              'reporter', v_name,
              'comment',  left(v_body, 3000)))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('id', v_id);
end $$;

comment on function public.add_ticket_comment(uuid, text, text) is
  'ADR-0202: add an update to a ticket — a note, email, call, meeting or task. Back Office logins only, a Viewer refused (read_only). Bumps updated_at and queues TK1 (variant comment, key TK1:comment:<comment id>).';

revoke all on function public.add_ticket_comment(uuid, text, text) from public, anon;
grant execute on function public.add_ticket_comment(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5 · update_ticket
-- ---------------------------------------------------------------------
create or replace function public.update_ticket(
  p_ticket     uuid,
  p_status     text default null,
  p_severity   text default null,
  p_note       text default null,
  p_resolution text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t         tickets;
  v_status  text := nullif(btrim(coalesce(p_status, '')), '');
  v_sev     text := nullif(btrim(coalesce(p_severity, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_res     text := nullif(btrim(coalesce(p_resolution, '')), '');
  v_name    text;
  v_changed boolean := false;
  v_label   jsonb := jsonb_build_object(
              'new', 'New', 'in_progress', 'In progress', 'waiting', 'Waiting',
              'resolved', 'Resolved', 'closed', 'Closed',
              'low', 'Low', 'medium', 'Medium', 'high', 'High', 'critical', 'Critical');
  v_cid     bigint;
  v_rid     bigint;
  v_final   text;
  v_to      text[];
  v_email   text;
begin
  perform assert_office_caller();
  if not office_can('write') then
    raise exception 'read_only' using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('new', 'in_progress', 'waiting', 'resolved', 'closed') then
    raise exception 'Choose a status from the list.' using errcode = '22023';
  end if;
  -- 'none' clears the severity
  if v_sev is not null and v_sev not in ('low', 'medium', 'high', 'critical', 'none') then
    raise exception 'Choose a severity from the list.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 5000 then
    raise exception 'A note is at most 5,000 characters.' using errcode = '22023';
  end if;
  if v_res is not null and char_length(v_res) > 2000 then
    raise exception 'A resolution note is at most 2,000 characters.' using errcode = '22023';
  end if;

  select * into t from tickets where id = p_ticket for update;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;

  v_final := coalesce(v_status, t.status);
  if v_res is not null and v_final not in ('resolved', 'closed') then
    raise exception 'A resolution note goes with Resolved or Closed.' using errcode = '22023';
  end if;

  v_name := coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()),
                     'Back Office user');

  if v_status is not null and v_status is distinct from t.status then
    insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
    values (t.id, 'change',
            'Status: ' || (v_label ->> t.status) || ' → ' || (v_label ->> v_status),
            auth.uid(), v_name);
    update tickets
       set status = v_status,
           resolved_at = case when v_status in ('resolved', 'closed')
                              then coalesce(resolved_at, now()) else null end
     where id = t.id;
    v_changed := true;

    -- A ticket put on hold or finished stops the caller's own running timer
    -- on it and logs what it ran (ADR-0202). Only the tracker's own: a
    -- manager changing a status never touches, or learns of, a timer.
    if v_status in ('waiting', 'resolved', 'closed') and ticket_tracker_allowed() then
      update ticket_time
         set ended_at = now(),
             minutes = least(1440, greatest(1, round(extract(epoch from now() - started_at) / 60)::int))
       where ticket_id = t.id and logged_by = auth.uid()
         and started_at is not null and ended_at is null;
    end if;
  end if;

  if v_sev is not null and v_sev is distinct from coalesce(t.severity, 'none') then
    insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
    values (t.id, 'change',
            'Severity: ' || coalesce(v_label ->> t.severity, 'Not set') || ' → '
              || case when v_sev = 'none' then 'Not set' else v_label ->> v_sev end,
            auth.uid(), v_name);
    update tickets set severity = case when v_sev = 'none' then null else v_sev end where id = t.id;
    v_changed := true;
  end if;

  -- The resolution note: kept on the ticket, shown on the thread, and emailed
  -- to the person who reported it (their own sign-in address, read here and
  -- never taken from the caller).
  if v_res is not null then
    update tickets set resolution = v_res where id = t.id;
    insert into ticket_comments (ticket_id, kind, activity, body, author_id, author_name)
    values (t.id, 'comment', 'note', 'Resolution: ' || v_res, auth.uid(), v_name)
    returning id into v_rid;
    v_changed := true;

    select lower(btrim(u.email)) into v_email from auth.users u where u.id = t.reporter_id;
    if v_email ~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$' then
      insert into notification_outbox (key, channel, template, recipient_emails, payload)
      values ('TK1:resolved:' || v_rid::text, 'email', 'TK1', array[v_email],
              jsonb_build_object(
                'variant',    'resolved',
                'ref',        'TK-' || t.ticket_no,
                'title',      t.title,
                'status',     v_label ->> v_final,
                'reporter',   t.reporter_name,
                'resolution', left(v_res, 2000)))
      on conflict (key) do nothing;
    end if;
  end if;

  if v_note is not null then
    insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
    values (t.id, 'comment', v_note, auth.uid(), v_name)
    returning id into v_cid;
    v_changed := true;

    v_to := ticket_recipient_emails();
    if cardinality(v_to) > 0 then
      insert into notification_outbox (key, channel, template, recipient_emails, payload)
      values ('TK1:comment:' || v_cid::text, 'email', 'TK1', v_to,
              jsonb_build_object(
                'variant',  'comment',
                'ref',      'TK-' || t.ticket_no,
                'title',    t.title,
                'status',   v_label ->> v_final,
                'reporter', v_name,
                'comment',  left(v_note, 3000)))
      on conflict (key) do nothing;
    end if;
  end if;

  if v_changed then
    update tickets set updated_at = now() where id = t.id;
  end if;

  return jsonb_build_object('id', t.id, 'changed', v_changed);
end $$;

comment on function public.update_ticket(uuid, text, text, text, text) is
  'ADR-0202: change a ticket''s status and / or severity (none clears it), with an optional note and, for Resolved / Closed, a resolution note that is emailed to the reporter (TK1 variant resolved, their own sign-in address). Office logins that may write (not a Viewer). Each change is a kind = change line on the thread; resolved_at is set on Resolved / Closed and cleared on a reopen; a note is a comment and is emailed to settings.ticket_recipients (variant comment). Stops the caller''s own running timer when the ticket is put on hold or finished.';

revoke all on function public.update_ticket(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_ticket(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5b · Triage: category, owner, and deleting a report
-- ---------------------------------------------------------------------

-- The office logins a ticket can be given to (Owner column on the ticket).
create or replace function public.ticket_assignees()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform assert_office_caller();
  return query
    select p.id, p.full_name
      from profiles p
     where p.role = 'admin'
     order by lower(p.full_name), p.id;
end $$;

comment on function public.ticket_assignees() is
  'ADR-0202: the Back Office logins (id, name) a ticket can be given to. Office logins only.';

revoke all on function public.ticket_assignees() from public, anon;
grant execute on function public.ticket_assignees() to authenticated;

create or replace function public.assign_ticket(
  p_ticket   uuid,
  p_assignee uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t      tickets;
  v_name text;
  v_who  text;
begin
  perform assert_office_caller();
  if not office_can('write') then
    raise exception 'read_only' using errcode = '42501';
  end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if p_assignee is not null then
    select nullif(btrim(p.full_name), '') into v_who
      from profiles p where p.id = p_assignee and p.role = 'admin';
    if v_who is null then
      raise exception 'Choose a Back Office login from the list.' using errcode = '22023';
    end if;
  end if;
  if p_assignee is not distinct from t.assignee_id then
    return jsonb_build_object('id', t.id, 'changed', false);
  end if;
  v_name := coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()),
                     'Back Office user');
  update tickets
     set assignee_id = p_assignee, assignee_name = v_who, updated_at = now()
   where id = t.id;
  insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
  values (t.id, 'change',
          'Owner: ' || coalesce(t.assignee_name, 'Unassigned') || ' → ' || coalesce(v_who, 'Unassigned'),
          auth.uid(), v_name);
  return jsonb_build_object('id', t.id, 'changed', true);
end $$;

comment on function public.assign_ticket(uuid, uuid) is
  'ADR-0202: give a ticket to a Back Office login, or to nobody (null). Office logins that may write. A line on the thread.';

revoke all on function public.assign_ticket(uuid, uuid) from public, anon;
grant execute on function public.assign_ticket(uuid, uuid) to authenticated;

create or replace function public.set_ticket_kind(
  p_ticket uuid,
  p_kind   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t      tickets;
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_name text;
  v_word jsonb := jsonb_build_object('bug', 'Bug', 'request', 'Request', 'idea', 'Idea',
                                     'update', 'Update', 'question', 'Question');
begin
  perform assert_office_caller();
  if not office_can('write') then
    raise exception 'read_only' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('bug', 'request', 'idea', 'update', 'question') then
    raise exception 'Choose a category from the list.' using errcode = '22023';
  end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if v_kind = t.kind then
    return jsonb_build_object('id', t.id, 'changed', false);
  end if;
  v_name := coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()),
                     'Back Office user');
  update tickets set kind = v_kind, updated_at = now() where id = t.id;
  insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
  values (t.id, 'change', 'Category: ' || (v_word ->> t.kind) || ' → ' || (v_word ->> v_kind),
          auth.uid(), v_name);
  return jsonb_build_object('id', t.id, 'changed', true);
end $$;

comment on function public.set_ticket_kind(uuid, text) is
  'ADR-0202: re-file a ticket as a bug, request, idea, update or question. Office logins that may write. A line on the thread.';

revoke all on function public.set_ticket_kind(uuid, text) from public, anon;
grant execute on function public.set_ticket_kind(uuid, text) to authenticated;

-- Deleting a report: owners only, and never one with time logged on it,
-- so a month's bill can always be traced back to its tickets.
create or replace function public.delete_ticket(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform assert_office_caller();
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from tickets where id = p_ticket) then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if exists (select 1 from ticket_time where ticket_id = p_ticket) then
    raise exception 'ticket_has_time' using errcode = 'P0001';
  end if;
  delete from tickets where id = p_ticket;
  return jsonb_build_object('id', p_ticket);
end $$;

comment on function public.delete_ticket(uuid) is
  'ADR-0202: delete a report and its thread. Owners only; refused (ticket_has_time) while any time is logged on it, so a bill can always be traced. Close it instead.';

revoke all on function public.delete_ticket(uuid) from public, anon;
grant execute on function public.delete_ticket(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6 · The owner's tracking: who may, the label, the time
-- ---------------------------------------------------------------------
insert into public.settings (key, value)
values ('ticket_tracking_emails', '[]'::jsonb)
on conflict (key) do nothing;

-- May the signed-in login see and keep ticket labels and time? An Owner;
-- and, once settings.ticket_tracking_emails names anybody, only those
-- logins (by their sign-in email). Definer: it reads auth.users. Used by
-- the policies below and by the screens.
create or replace function public.ticket_tracker_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    office_can('users')
    and (
      not exists (
        select 1
          from public.settings s,
               lateral jsonb_array_elements_text(
                 case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) e
         where s.key = 'ticket_tracking_emails' and btrim(e) <> '')
      or exists (
        select 1
          from auth.users u, public.settings s,
               lateral jsonb_array_elements_text(
                 case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) e
         where u.id = auth.uid() and s.key = 'ticket_tracking_emails'
           and lower(btrim(e)) = lower(u.email))
    ), false)
$$;

comment on function public.ticket_tracker_allowed() is
  'ADR-0202: may this login see and keep ticket scope labels and time? An Owner office login; when settings.ticket_tracking_emails lists any address, only logins with one of those sign-in emails. False for everyone else, and for a session below its two-step level.';

revoke all on function public.ticket_tracker_allowed() from public, anon;
grant execute on function public.ticket_tracker_allowed() to authenticated, service_role;

create table if not exists public.ticket_scope (
  ticket_id  uuid primary key references public.tickets(id) on delete cascade,
  label      text not null check (label in ('fix', 'update', 'issue', 'against_scope', 'addition')),
  note       text check (note is null or char_length(note) <= 500),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.ticket_scope is
  'ADR-0202: the owner''s internal label for a ticket against the original scope. Set after the ticket is raised, by set_ticket_scope(); readable only by ticket_tracker_allowed().';

create index if not exists ticket_scope_updated_by_idx on public.ticket_scope (updated_by);

create table if not exists public.ticket_time (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  worked_by  text not null check (worked_by in ('owner', 'claude')),
  worked_on  date not null,
  started_at timestamptz,
  ended_at   timestamptz,
  minutes    integer check (minutes between 1 and 1440),
  billable   boolean not null default false,
  note       text check (note is null or char_length(note) <= 500),
  logged_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- a stopped or manual entry has minutes; a running timer has a start and no end
  check (minutes is not null or (started_at is not null and ended_at is null)),
  check (ended_at is null or minutes is not null)
);

comment on table public.ticket_time is
  'ADR-0202: time spent on a ticket — a timer (started_at, ended_at null while it runs) or a manual entry — by the owner or by claude, billable or not. Internal; written by the ticket time functions, readable only by ticket_tracker_allowed().';

create index if not exists ticket_time_ticket_idx on public.ticket_time (ticket_id, worked_on);
create index if not exists ticket_time_worked_on_idx on public.ticket_time (worked_on);
create index if not exists ticket_time_logged_by_idx on public.ticket_time (logged_by);
-- one running timer per login
create unique index if not exists ticket_time_one_running_idx
  on public.ticket_time (logged_by) where started_at is not null and ended_at is null;

alter table public.ticket_scope enable row level security;
alter table public.ticket_time enable row level security;

drop policy if exists admin_owner_read on public.ticket_scope;
create policy admin_owner_read on public.ticket_scope
  for select using ((select ticket_tracker_allowed()));
drop policy if exists admin_owner_read on public.ticket_time;
create policy admin_owner_read on public.ticket_time
  for select using ((select ticket_tracker_allowed()));

revoke all on public.ticket_scope, public.ticket_time from public, anon, authenticated;
grant select on public.ticket_scope, public.ticket_time to authenticated;
grant all on public.ticket_scope, public.ticket_time to service_role;

drop trigger if exists office_read_only on public.ticket_scope;
create trigger office_read_only before insert or update or delete or truncate
  on public.ticket_scope
  for each statement execute function public.office_read_only_guard();
drop trigger if exists office_read_only on public.ticket_time;
create trigger office_read_only before insert or update or delete or truncate
  on public.ticket_time
  for each statement execute function public.office_read_only_guard();

-- Internal: the common door of the six functions below.
create or replace function public.assert_ticket_tracker()
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  perform assert_office_caller();
  if not ticket_tracker_allowed() then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
end $$;

revoke all on function public.assert_ticket_tracker() from public, anon, authenticated;
grant execute on function public.assert_ticket_tracker() to service_role;

-- set_ticket_scope · label a ticket (or clear it with a null / empty label)
create or replace function public.set_ticket_scope(
  p_ticket uuid,
  p_label  text,
  p_note   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform assert_ticket_tracker();
  if not exists (select 1 from tickets where id = p_ticket) then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if v_label is null then
    delete from ticket_scope where ticket_id = p_ticket;
    return jsonb_build_object('label', null);
  end if;
  if v_label not in ('fix', 'update', 'issue', 'against_scope', 'addition') then
    raise exception 'Choose a label from the list.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A scope note is at most 500 characters.' using errcode = '22023';
  end if;
  insert into ticket_scope (ticket_id, label, note, updated_by, updated_at)
  values (p_ticket, v_label, v_note, auth.uid(), now())
  on conflict (ticket_id) do update
     set label = excluded.label, note = excluded.note,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('label', v_label);
end $$;

comment on function public.set_ticket_scope(uuid, text, text) is
  'ADR-0202: label a ticket fix / update / issue / against_scope / addition, with an optional note; an empty label clears it. Trackers only (ticket_tracker_allowed()). Writes nothing the reporter or the office can see.';

-- start_ticket_timer · one running timer per login; a New ticket becomes In progress
create or replace function public.start_ticket_timer(
  p_ticket    uuid,
  p_worked_by text default 'owner',
  p_billable  boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t        tickets;
  v_by     text := coalesce(nullif(btrim(p_worked_by), ''), 'owner');
  v_bill   boolean;
  v_id     bigint;
  v_started timestamptz := now();
begin
  perform assert_ticket_tracker();
  if v_by not in ('owner', 'claude') then
    raise exception 'Choose who is working on it.' using errcode = '22023';
  end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if exists (select 1 from ticket_time
              where logged_by = auth.uid() and started_at is not null and ended_at is null) then
    raise exception 'timer_running' using errcode = 'P0001';
  end if;
  v_bill := coalesce(p_billable,
                     (select s.label in ('against_scope', 'addition')
                        from ticket_scope s where s.ticket_id = t.id),
                     false);
  insert into ticket_time (ticket_id, worked_by, worked_on, started_at, billable, logged_by)
  values (t.id, v_by, (v_started at time zone 'Europe/London')::date, v_started, v_bill, auth.uid())
  returning id into v_id;

  if t.status = 'new' then
    insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
    values (t.id, 'change', 'Status: New → In progress', auth.uid(),
            coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()),
                     'Back Office user'));
    update tickets set status = 'in_progress', updated_at = now() where id = t.id;
  end if;
  return jsonb_build_object('id', v_id, 'startedAt', v_started);
end $$;

comment on function public.start_ticket_timer(uuid, text, boolean) is
  'ADR-0202: start the caller''s timer on a ticket, worked by owner or claude; billable defaults from the ticket''s label (against_scope and addition). One running timer per login (timer_running). A New ticket moves to In progress. Trackers only.';

-- stop_ticket_timer · stops the caller's running timer and logs the minutes
create or replace function public.stop_ticket_timer(
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r        ticket_time;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_min    integer;
begin
  perform assert_ticket_tracker();
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A note is at most 500 characters.' using errcode = '22023';
  end if;
  select * into r from ticket_time
   where logged_by = auth.uid() and started_at is not null and ended_at is null
   for update;
  if r.id is null then
    raise exception 'no_timer' using errcode = 'P0002';
  end if;
  v_min := least(1440, greatest(1, round(extract(epoch from now() - r.started_at) / 60)::int));
  update ticket_time
     set ended_at = now(), minutes = v_min, note = coalesce(v_note, note)
   where id = r.id;
  return jsonb_build_object('id', r.id, 'ticketId', r.ticket_id, 'minutes', v_min);
end $$;

comment on function public.stop_ticket_timer(text) is
  'ADR-0202: stop the caller''s running timer and log its minutes (rounded, at least 1, at most 24 h). Trackers only.';

-- log_ticket_time · a manual entry (the 5, 10, 15 minutes after an email)
create or replace function public.log_ticket_time(
  p_ticket    uuid,
  p_minutes   integer,
  p_worked_by text default 'owner',
  p_worked_on date default null,
  p_note      text default null,
  p_billable  boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_by   text := coalesce(nullif(btrim(p_worked_by), ''), 'owner');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_day  date := coalesce(p_worked_on, (now() at time zone 'Europe/London')::date);
  v_bill boolean;
  v_id   bigint;
begin
  perform assert_ticket_tracker();
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'Time is between 1 minute and 24 hours.' using errcode = '22023';
  end if;
  if v_by not in ('owner', 'claude') then
    raise exception 'Choose who did the work.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A note is at most 500 characters.' using errcode = '22023';
  end if;
  if v_day > (now() at time zone 'Europe/London')::date then
    raise exception 'The date cannot be in the future.' using errcode = '22023';
  end if;
  if not exists (select 1 from tickets where id = p_ticket) then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  v_bill := coalesce(p_billable,
                     (select s.label in ('against_scope', 'addition')
                        from ticket_scope s where s.ticket_id = p_ticket),
                     false);
  insert into ticket_time (ticket_id, worked_by, worked_on, minutes, billable, note, logged_by)
  values (p_ticket, v_by, v_day, p_minutes, v_bill, v_note, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

comment on function public.log_ticket_time(uuid, integer, text, date, text, boolean) is
  'ADR-0202: log time by hand — 1 minute to 24 hours, by owner or claude, on a date (UK, not in the future), billable defaulting from the ticket''s label. Trackers only.';

-- update_ticket_time · correct a finished entry
create or replace function public.update_ticket_time(
  p_id        bigint,
  p_minutes   integer,
  p_worked_by text,
  p_worked_on date,
  p_note      text,
  p_billable  boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r      ticket_time;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform assert_ticket_tracker();
  select * into r from ticket_time where id = p_id for update;
  if r.id is null then
    raise exception 'unknown_time' using errcode = 'P0002';
  end if;
  if r.started_at is not null and r.ended_at is null then
    raise exception 'Stop the timer before changing it.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'Time is between 1 minute and 24 hours.' using errcode = '22023';
  end if;
  if p_worked_by not in ('owner', 'claude') then
    raise exception 'Choose who did the work.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A note is at most 500 characters.' using errcode = '22023';
  end if;
  if p_worked_on is null or p_worked_on > (now() at time zone 'Europe/London')::date then
    raise exception 'Choose a date that is not in the future.' using errcode = '22023';
  end if;
  update ticket_time
     set minutes = p_minutes, worked_by = p_worked_by, worked_on = p_worked_on,
         note = v_note, billable = coalesce(p_billable, billable)
   where id = p_id;
  return jsonb_build_object('id', p_id);
end $$;

comment on function public.update_ticket_time(bigint, integer, text, date, text, boolean) is
  'ADR-0202: correct a finished or manual time entry (a running timer must be stopped first). Trackers only.';

-- delete_ticket_time
create or replace function public.delete_ticket_time(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform assert_ticket_tracker();
  delete from ticket_time where id = p_id;
  if not found then
    raise exception 'unknown_time' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

comment on function public.delete_ticket_time(bigint) is
  'ADR-0202: remove a time entry, including a timer left running. Trackers only.';

revoke all on function public.set_ticket_scope(uuid, text, text) from public, anon;
revoke all on function public.start_ticket_timer(uuid, text, boolean) from public, anon;
revoke all on function public.stop_ticket_timer(text) from public, anon;
revoke all on function public.log_ticket_time(uuid, integer, text, date, text, boolean) from public, anon;
revoke all on function public.update_ticket_time(bigint, integer, text, date, text, boolean) from public, anon;
revoke all on function public.delete_ticket_time(bigint) from public, anon;
grant execute on function public.set_ticket_scope(uuid, text, text) to authenticated;
grant execute on function public.start_ticket_timer(uuid, text, boolean) to authenticated;
grant execute on function public.stop_ticket_timer(text) to authenticated;
grant execute on function public.log_ticket_time(uuid, integer, text, date, text, boolean) to authenticated;
grant execute on function public.update_ticket_time(bigint, integer, text, date, text, boolean) to authenticated;
grant execute on function public.delete_ticket_time(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 7 · notification_priorities(), restated from 20261023100000 with TK1
--     (normal, as CP1). priorityValuesSql() renders these rows.
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
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180), SC1 20261023100000 (ADR-0185), TK1 20261024120000 (ADR-0202).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
