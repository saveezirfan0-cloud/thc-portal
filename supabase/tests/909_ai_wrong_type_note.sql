-- =====================================================================
-- 909 · The reviewer sees the AI's "wrong kind of document" — ADR-0177,
--       20261022100000_review_view_reads_the_ai_type_verdict.sql
--
--   letter_c  a completion letter the AI said is a status letter
--             (matchesDocType false, with a note)            → the note
--   letter_i  the same verdict as an issue only, no note      → a sentence
--   letter_t  a term letter the AI said matches               → null
--
-- The admin reads the column; a worker and a client still read nothing.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

\set letter_c '90900000-0000-4000-8000-0000000000c1'
\set letter_i '90900000-0000-4000-8000-0000000000c2'
\set letter_t '90900000-0000-4000-8000-0000000000c3'

insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, ai_extracted, ai_confidence) values
  (:'letter_c', :'staffa', 'university_completion_letter', 'documents/a/c.pdf', 'pending',
   '{"answer": {"matchesDocType": false, "notes": "This is a current enrolment/status confirmation letter, not a completion letter."}, "issues": ["not_this_document_type", "no_completion_date"]}',
   0),
  (:'letter_i', :'staffa', 'university_completion_letter', 'documents/a/i.pdf', 'pending',
   '{"answer": {"notes": "  "}, "issues": ["not_this_document_type"]}', 0),
  (:'letter_t', :'staffa', 'university_term_dates_letter', 'documents/a/t.pdf', 'pending',
   '{"answer": {"matchesDocType": true, "notes": "Points to a website for term dates."}, "issues": ["no_holidays"]}', 0.3);

select has_column('public', 'compliance_doc_review_v', 'ai_wrong_type_note',
  'compliance_doc_review_v carries the AI''s wrong-type note');
select is((select attnum::int from pg_attribute
            where attrelid = 'public.compliance_doc_review_v'::regclass and attname = 'ai_wrong_type_note'), 12,
  'appended after the eleven columns ADR-0163 named, so every reader keeps its shape');

-- The office.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select ai_wrong_type_note from compliance_doc_review_v where document_id = :'letter_c'),
  'This is a current enrolment/status confirmation letter, not a completion letter.',
  'admin: the AI''s own note when it says the upload is another kind of document');
select is((select ai_wrong_type_note from compliance_doc_review_v where document_id = :'letter_i'),
  'The AI read this upload as a different kind of document.',
  'admin: a plain sentence when the verdict came with no note');
select is((select ai_wrong_type_note from compliance_doc_review_v where document_id = :'letter_t'), null,
  'admin: nothing when the AI said the document matches');

-- A worker, on their own uploads.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from compliance_doc_review_v), 0, 'a worker reads nothing, own letters included');

-- A client.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from compliance_doc_review_v), 0, 'a client reads nothing');

reset role;
select * from finish();
rollback;
