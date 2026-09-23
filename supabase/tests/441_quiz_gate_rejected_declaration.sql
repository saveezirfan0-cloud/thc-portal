-- =====================================================================
-- 441 · A rejected "Yes" declaration holds the quiz gate (§2.3, §2.10)
--   20260923191000_quiz_gate_holds_a_rejected_declaration.sql
-- =====================================================================
begin;
select plan(6);
\ir _shared/fixtures.psql

\set c    '44100000-0000-4000-8000-000000000001'
\set decl '44100000-0000-4000-8000-0000000000e1'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch)
values (:'c', 'Rae', 'Jected', 'rae@gate.test', '+447700944101', date '2000-01-01', 'documents', 'uk_irish');

insert into criminal_declarations (id, staff_id, source, answer, details)
values (:'decl', :'c', 'onboarding', true, 'Caution, 2019');
update criminal_declarations set review_status = 'rejected', reviewed_at = now(), review_note = 'Details incomplete'
 where id = :'decl';

select ok('conviction_rejected' = any(onboarding_quiz_blockers(:'c')),
  'a rejected Yes is a blocker for a candidate — it is not the same as having declared');
select ok(not exists (select 1 from compliance_blockers(:'c') where reason = 'conviction_rejected'),
  'while compliance_blockers() is unchanged: for a worker §10.7''s manual block carries it');

-- Everything else verified: the gate must still hold.
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
select :'c', t::doc_type, 'c/' || t || '.pdf', 'verified'
  from unnest(onboarding_documents_missing(:'c')) t
 where t in (select unnest(enum_range(null::doc_type))::text);
select is(onboarding_quiz_blockers(:'c'), array['conviction_rejected'],
  'with every document verified, the rejected Yes is the only thing left holding the gate');
select is((select status::text from staff where id = :'c'), 'documents',
  'verifying the documents does not move a candidate with a rejected Yes to the quiz');

-- A fresh declaration supersedes the rejected one.
update criminal_declarations set superseded = true where id = :'decl';
insert into criminal_declarations (staff_id, source, answer, details)
values (:'c', 'onboarding', true, 'Caution, 2019 — Metropolitan Police, no further action');
select ok(not ('conviction_rejected' = any(onboarding_quiz_blockers(:'c'))),
  'declaring again clears conviction_rejected …');
select ok('conviction_unreviewed' = any(onboarding_quiz_blockers(:'c')),
  '… and the new Yes waits for review like any other');

select * from finish();
rollback;
