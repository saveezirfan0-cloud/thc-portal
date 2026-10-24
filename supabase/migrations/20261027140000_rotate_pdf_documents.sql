-- =====================================================================
-- Migration 20261027140000 · Rotate a PDF too (ADR-0214, ticket TK-24)
--
-- ADR-0212's Rotate turned JPEG and PNG photos only. A passport uploaded
-- as a PDF (a phone scan, or a photo saved as PDF) came in the wrong way
-- round with no way to turn it: the office's only answer was Reject again.
--
-- turn_document_upright() now also takes a pending PDF: the Back Office
-- turns every page with pdf-lib (the page's /Rotate, so nothing is
-- re-compressed) and writes a .pdf beside the original. Everything else is
-- 20261027110000's body unchanged — pending only, same file, the worker's
-- folder, the purge queue, the audit line.
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
  v_pdf   boolean;
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
  -- ADR-0214: a PDF is turned too (its pages, by the office) and stays a PDF.
  if coalesce(d.mime_type, '') not in ('image/jpeg', 'image/png', 'application/pdf') then
    raise exception 'not_a_photo' using errcode = 'P0001';
  end if;
  v_pdf := d.mime_type = 'application/pdf';
  if p_to is null
     or p_to not like d.staff_id::text || '/%'
     or p_to !~ ('^[0-9a-f-]+/[a-z_-]+/[0-9a-f-]+\.' || (case when v_pdf then 'pdf' else 'jpg' end) || '$')
     or p_to = p_from then
    raise exception 'bad_path' using errcode = 'P0001';
  end if;
  if p_size is null or p_size <= 0 then
    raise exception 'bad_size' using errcode = 'P0001';
  end if;

  update compliance_docs
     set file_path = p_to,
         mime_type = case when v_pdf then 'application/pdf' else 'image/jpeg' end,
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
  'ADR-0212, ADR-0214: swaps a pending JPEG/PNG document''s file for an upright copy (a .jpg in the same worker''s folder), or a pending PDF''s for one with its pages turned (a .pdf), turned 90/180/270 degrees clockwise. The AI read (service role) or an office login that may write; refuses not_pending, file_changed, not_a_photo, bad_path, bad_turn. Audited as document.turned_upright; the replaced file is queued in storage_deletions.';

revoke all on function public.turn_document_upright(uuid, text, text, int, int) from public, anon;
grant execute on function public.turn_document_upright(uuid, text, text, int, int) to authenticated, service_role;
