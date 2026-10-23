-- =====================================================================
-- Migration 20261026110000 · Screenshots, videos and screen recordings on
--                            a ticket (ADR-0204, extends ADR-0202)
--
-- 23.10.2026 call: the feedback button takes "optional voice dictation,
-- plus screenshot, video or screen recording". Dictation shipped with
-- ADR-0202; a file could only be a pasted link ("Not in this version").
-- This adds the files.
--
--   · `ticket-files`, a PRIVATE bucket (50 MB an object; PNG, JPEG, WebP,
--     GIF, MP4, WebM, MOV). Like `documents`, nothing reaches it by an API
--     role's own write: the Back Office server issues a one-object signed
--     upload URL with the service key, and the browser PUTs to it. There is
--     deliberately NO policy on storage.objects for this bucket: reads are
--     signed with the service key after the caller has read the
--     `ticket_files` row through RLS, so 320_storage's "which buckets does a
--     non-service policy mention" stays as it was.
--   · `ticket_files`, one row per file, admin_read, no API role writes it.
--   · `ticket_file_allowed(ticket)`: the person who filed a ticket may add
--     files to it for an hour, up to five. The server checks it before
--     issuing a URL; `attach_ticket_file` checks it again.
--   · `attach_ticket_file(ticket, path, kind, name)`: registers an upload.
--     Size and type are read back from what Storage recorded
--     (storage.objects.metadata), never taken from the caller, and the
--     object must exist, so a path nobody uploaded to cannot be attached.
--   · A trigger queues the object for removal when its row goes (a ticket
--     deleted, which cascades); gdpr-purge drains `storage_deletions`.
--
-- A Viewer reports nothing (ADR-0060), so owns no ticket and attaches
-- nothing; the office_read_only trigger covers the table as well.
-- pgTAP: supabase/tests/934_ticket_files.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The bucket
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ticket-files', 'ticket-files', false)
on conflict (id) do update set public = false;

update storage.buckets
   set file_size_limit    = 52428800,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif',
                                  'video/mp4', 'video/webm', 'video/quicktime']
 where id = 'ticket-files';

-- ---------------------------------------------------------------------
-- 2 · ticket_files
-- ---------------------------------------------------------------------
create table if not exists public.ticket_files (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  path        text not null unique,
  kind        text not null check (kind in ('screenshot', 'video', 'recording')),
  mime        text not null,
  bytes       bigint not null check (bytes between 1 and 52428800),
  file_name   text check (file_name is null or char_length(file_name) <= 200),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint ticket_files_path_in_ticket check (path like ticket_id::text || '/%')
);

comment on table public.ticket_files is
  'ADR-0204: a screenshot, video or screen recording attached to a ticket, held in the private ticket-files bucket under <ticket id>/. Written only by attach_ticket_file(); admin_read.';

create index if not exists ticket_files_ticket_idx on public.ticket_files (ticket_id, created_at);
create index if not exists ticket_files_uploaded_by_idx on public.ticket_files (uploaded_by);

alter table public.ticket_files enable row level security;

drop policy if exists admin_read on public.ticket_files;
create policy admin_read on public.ticket_files
  for select using ((select current_app_role()) = 'admin');

revoke all on public.ticket_files from public, anon, authenticated;
grant select on public.ticket_files to authenticated;
grant all on public.ticket_files to service_role;

drop trigger if exists office_read_only on public.ticket_files;
create trigger office_read_only before insert or update or delete or truncate
  on public.ticket_files
  for each statement execute function public.office_read_only_guard();

-- ---------------------------------------------------------------------
-- 3 · A deleted row owes its object a removal
-- ---------------------------------------------------------------------
create or replace function public.ticket_file_queue_removal()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into storage_deletions (bucket, path)
  values ('ticket-files', old.path)
  on conflict (bucket, path) do nothing;
  return old;
end $$;

revoke all on function public.ticket_file_queue_removal() from public, anon, authenticated;

drop trigger if exists ticket_file_queue_removal on public.ticket_files;
create trigger ticket_file_queue_removal after delete on public.ticket_files
  for each row execute function public.ticket_file_queue_removal();

-- ---------------------------------------------------------------------
-- 4 · May this login add a file to this ticket?
-- ---------------------------------------------------------------------
create or replace function public.ticket_file_allowed(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(current_app_role() = 'admin', false)
     and exists (select 1 from tickets t
                  where t.id = p_ticket
                    and t.reporter_id = auth.uid()
                    and t.created_at > now() - interval '1 hour')
     and (select count(*) from ticket_files f where f.ticket_id = p_ticket) < 5
$$;

comment on function public.ticket_file_allowed(uuid) is
  'ADR-0204: true when the signed-in Back Office login filed this ticket in the last hour and it holds fewer than five files. The server asks before issuing an upload URL; attach_ticket_file asks again.';

revoke all on function public.ticket_file_allowed(uuid) from public, anon;
grant execute on function public.ticket_file_allowed(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5 · Register an upload
-- ---------------------------------------------------------------------
create or replace function public.attach_ticket_file(
  p_ticket uuid,
  p_path   text,
  p_kind   text,
  p_name   text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind  text := btrim(coalesce(p_kind, ''));
  v_name  text := nullif(left(btrim(coalesce(p_name, '')), 200), '');
  v_mime  text;
  v_bytes bigint;
  v_id    uuid;
begin
  perform assert_office_caller();

  if p_ticket is null or not exists (select 1 from tickets where id = p_ticket) then
    raise exception 'unknown_ticket' using errcode = 'P0002';
  end if;
  if not ticket_file_allowed(p_ticket) then
    raise exception 'cannot_attach' using errcode = 'P0001',
      detail = 'Only the person who filed a ticket can add files to it, within the hour, up to five.';
  end if;
  if v_kind not in ('screenshot', 'video', 'recording') then
    raise exception 'bad_file_kind' using errcode = '22023';
  end if;
  if coalesce(p_path, '') !~ ('^' || p_ticket::text || '/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm|mov)$') then
    raise exception 'bad_file_path' using errcode = '22023';
  end if;

  -- What Storage recorded, not what the caller says.
  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
    into v_mime, v_bytes
    from storage.objects o
   where o.bucket_id = 'ticket-files' and o.name = p_path;
  if v_mime is null or v_bytes is null then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if (v_kind = 'screenshot' and v_mime not like 'image/%')
     or (v_kind in ('video', 'recording') and v_mime not like 'video/%') then
    raise exception 'bad_file_kind' using errcode = '22023';
  end if;

  insert into ticket_files (ticket_id, path, kind, mime, bytes, file_name, uploaded_by)
  values (p_ticket, p_path, v_kind, v_mime, v_bytes, v_name, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

comment on function public.attach_ticket_file(uuid, text, text, text) is
  'ADR-0204: attach an uploaded screenshot, video or screen recording to a ticket the caller filed in the last hour (at most five). The object must exist in the ticket-files bucket under <ticket id>/; its size and type are read from Storage. Back Office logins only; a Viewer is refused read_only (ADR-0060). Returns the file id.';

revoke all on function public.attach_ticket_file(uuid, text, text, text) from public, anon;
grant execute on function public.attach_ticket_file(uuid, text, text, text) to authenticated;
