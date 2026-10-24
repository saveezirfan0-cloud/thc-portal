-- =====================================================================
-- Migration 20261027110000 · A document photo turned the right way up
--                            (ADR-0212, ticket TK-18)
--
-- Passports and other documents photographed sideways or upside down
-- reached the review queue as taken, and the office's only answer was to
-- reject and ask for the photo again.
--
-- turn_document_upright() swaps a document's stored file for an upright
-- copy of it, written beside the original by one of two callers:
--
--   * the AI read (service role): the reader says how far the photo must
--     turn; the Staff App turns it, reads the turned copy again, and only
--     swaps when that read says it is now the right way up;
--   * the office (Rotate on Needs review): a login that may write turns it
--     a quarter clockwise per press.
--
-- Either way:
--   * only while the document is pending review — never one already
--     verified, rejected or superseded, so what a reviewer decided on is
--     what stays on file;
--   * p_from must still be the row's file (a stale read never swaps a
--     newer one), and p_to a .jpg in the same worker's folder;
--   * a JPEG or PNG photo only — a PDF or HEIC is never turned;
--   * the turn is 90, 180 or 270 degrees clockwise;
--   * audited as document.turned_upright (from, to, degrees, by), and the
--     replaced file is owed to the purge queue (storage_deletions).
-- =====================================================================

create or replace function public.turn_document_upright(
  p_doc    uuid,
  p_from   text,
  p_to     text,
  p_size   int,
  p_turned int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  d       compliance_docs;
  v_by    text;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_by := 'ai';
  else
    perform assert_office_caller();
    -- ADR-0060: a viewer reads and changes nothing.
    perform assert_not_read_only();
    v_by := 'office';
  end if;

  if p_turned is null or p_turned not in (90, 180, 270) then
    raise exception 'bad_turn' using errcode = 'P0001';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if d.file_path is distinct from p_from then
    raise exception 'file_changed' using errcode = 'P0001';
  end if;
  if coalesce(d.mime_type, '') not in ('image/jpeg', 'image/png') then
    raise exception 'not_a_photo' using errcode = 'P0001';
  end if;
  if p_to is null
     or p_to not like d.staff_id::text || '/%'
     or p_to !~ '^[0-9a-f-]+/[a-z_-]+/[0-9a-f-]+\.jpg$'
     or p_to = p_from then
    raise exception 'bad_path' using errcode = 'P0001';
  end if;
  if p_size is null or p_size <= 0 then
    raise exception 'bad_size' using errcode = 'P0001';
  end if;

  update compliance_docs
     set file_path = p_to,
         mime_type = 'image/jpeg',
         file_size = p_size,
         size_bytes = p_size
   where id = d.id;

  insert into storage_deletions (bucket, path, staff_id)
  values ('documents', p_from, d.staff_id)
  on conflict (bucket, path) do nothing;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'document.turned_upright', 'compliance_doc', d.id,
          jsonb_build_object('from', p_from, 'to', p_to, 'degrees', p_turned, 'by', v_by));

  return jsonb_build_object('ok', true, 'path', p_to, 'degrees', p_turned, 'by', v_by);
end $$;

comment on function public.turn_document_upright(uuid, text, text, int, int) is
  'ADR-0212: swaps a pending JPEG/PNG document''s file for an upright copy (a .jpg in the same worker''s folder) turned 90/180/270 degrees clockwise. The AI read (service role) or an office login that may write; refuses not_pending, file_changed, not_a_photo, bad_path, bad_turn. Audited as document.turned_upright; the replaced file is queued in storage_deletions.';

revoke all on function public.turn_document_upright(uuid, text, text, int, int) from public, anon;
grant execute on function public.turn_document_upright(uuid, text, text, int, int) to authenticated, service_role;
