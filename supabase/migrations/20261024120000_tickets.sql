-- =====================================================================
-- Migration 20261024120000 · Tickets: the team logs issues, requests and
--                            updates from the Back Office (ADR-0198)
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
--     Deliberately NO office_read_only trigger: a Viewer may read the
--     Back Office but is exactly the person who reports "I can't see X";
--     reporting and commenting change no business record. Changing a
--     ticket's status or severity is still `write` (office_can).
-- 3 · create_ticket()      — any Back Office login. Saves the ticket and
--                            queues TK1 (variant `new`) to the addresses
--                            in settings.ticket_recipients. At most 20 a
--                            hour per login.
-- 4 · add_ticket_comment() — any Back Office login. Queues TK1 (variant
--                            `comment`).
-- 5 · update_ticket()      — `write` only. Status and severity; each
--                            change is a line in the thread, and an
--                            optional note is a comment (and is emailed).
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
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

comment on table public.tickets is
  'ADR-0198: a report logged from the Back Office (issue, request, idea, update, question), numbered TK-<ticket_no>. Written only by create_ticket() and update_ticket(); admin_read.';

create index if not exists tickets_status_created_idx on public.tickets (status, created_at desc);
create index if not exists tickets_created_idx on public.tickets (created_at desc);
create index if not exists tickets_reporter_id_idx on public.tickets (reporter_id);

-- ---------------------------------------------------------------------
-- 2 · ticket_comments
-- ---------------------------------------------------------------------
create table if not exists public.ticket_comments (
  id           bigint generated always as identity primary key,
  ticket_id    uuid not null references public.tickets(id) on delete cascade,
  kind         text not null default 'comment' check (kind in ('comment', 'change')),
  body         text not null check (char_length(body) between 1 and 5000),
  author_id    uuid references public.profiles(id) on delete set null,
  author_name  text not null,
  created_at   timestamptz not null default now()
);

comment on table public.ticket_comments is
  'ADR-0198: the thread on a ticket — comments, and the status / severity changes as kind = change. Written only by add_ticket_comment() and update_ticket(); admin_read.';

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
  'ADR-0198: the addresses a ticket email goes to, from settings.ticket_recipients. Internal; not granted to any API role.';

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
  'ADR-0198: log a ticket (kind, optional severity, summary 3–200, details ≤ 5000, the page it was logged on, an optional recording link). Any Back Office login, a Viewer too; at most 20 an hour per login. Saves the ticket and queues TK1 (variant new, key TK1:ticket:<id>) to settings.ticket_recipients. Returns {id, number, ref}.';

revoke all on function public.create_ticket(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_ticket(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · add_ticket_comment
-- ---------------------------------------------------------------------
create or replace function public.add_ticket_comment(
  p_ticket uuid,
  p_body   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t        tickets;
  v_body   text := btrim(coalesce(p_body, ''));
  v_name   text;
  v_id     bigint;
  v_to     text[];
begin
  perform assert_office_caller();

  if v_body = '' then
    raise exception 'Write a comment first.' using errcode = '22023';
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

  insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
  values (t.id, 'comment', v_body, auth.uid(), v_name)
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

comment on function public.add_ticket_comment(uuid, text) is
  'ADR-0198: add a comment to a ticket. Any Back Office login, a Viewer too. Bumps updated_at and queues TK1 (variant comment, key TK1:comment:<comment id>).';

revoke all on function public.add_ticket_comment(uuid, text) from public, anon;
grant execute on function public.add_ticket_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5 · update_ticket
-- ---------------------------------------------------------------------
create or replace function public.update_ticket(
  p_ticket   uuid,
  p_status   text default null,
  p_severity text default null,
  p_note     text default null
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
  v_name    text;
  v_changed boolean := false;
  v_label   jsonb := jsonb_build_object(
              'new', 'New', 'in_progress', 'In progress', 'waiting', 'Waiting',
              'resolved', 'Resolved', 'closed', 'Closed',
              'low', 'Low', 'medium', 'Medium', 'high', 'High', 'critical', 'Critical');
  v_cid     bigint;
  v_to      text[];
begin
  perform assert_office_caller();
  if not office_can('write') then
    raise exception 'read_only' using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('new', 'in_progress', 'waiting', 'resolved', 'closed') then
    raise exception 'Choose a status from the list.' using errcode = '22023';
  end if;
  if v_sev is not null and v_sev not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Choose a severity from the list.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 5000 then
    raise exception 'A note is at most 5,000 characters.' using errcode = '22023';
  end if;

  select * into t from tickets where id = p_ticket for update;
  if t.id is null then
    raise exception 'unknown_ticket' using errcode = 'P0002';
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
  end if;

  if v_sev is not null and v_sev is distinct from t.severity then
    insert into ticket_comments (ticket_id, kind, body, author_id, author_name)
    values (t.id, 'change',
            'Severity: ' || coalesce(v_label ->> t.severity, 'Not set') || ' → ' || (v_label ->> v_sev),
            auth.uid(), v_name);
    update tickets set severity = v_sev where id = t.id;
    v_changed := true;
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
                'status',   v_label ->> coalesce(v_status, t.status),
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

comment on function public.update_ticket(uuid, text, text, text) is
  'ADR-0198: change a ticket''s status and / or severity, with an optional note. Office logins that may write (not a Viewer). Each change is a kind = change line on the thread; resolved_at is set on Resolved / Closed and cleared on a reopen; a note is a comment and is emailed (TK1 variant comment).';

revoke all on function public.update_ticket(uuid, text, text, text) from public, anon;
grant execute on function public.update_ticket(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6 · notification_priorities(), restated from 20261023100000 with TK1
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
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180), SC1 20261023100000 (ADR-0185), TK1 20261024120000 (ADR-0198).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
