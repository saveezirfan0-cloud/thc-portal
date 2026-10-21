-- =====================================================================
-- 915 · A criminal declaration: Ask for more details, Update your
--       declaration, Reverse rejection (ADR-0180)
--   20261022170000_declaration_details_requested_status.sql
--   20261022170100_declaration_more_details.sql
--
-- The office's question: when a Yes declaration's details are not
-- enough, ask for full details rather than reject — and when the office
-- decides the person can work after all, overturn the rejection. Held
-- here end to end:
--
--   A  candidate · ask → DR1 with a unique key → the declaration leaves
--      the queue and holds the gate → the candidate answers → old row
--      superseded and untouched, new row pending and back in the queue →
--      Verify moves them on to the quiz
--   B  candidate · Reject → N8 → the candidate answers the rejection
--   C  candidate · Reverse rejection → quiz; the rejection stays on the row
--   D  worker · ask → the review block stays → answer → Verify → N15
--   E  worker · Reject → manual hold → Reverse lifts that hold → N15
--   F  worker · a manager's own manual block is not lifted by a reversal
--   G  the guard: illegal transitions and edits refused, whoever tries
--   H  who reads and calls what (admin / client / staff / anon)
--   I  §1.7: the new texts go with a GDPR removal
--   J  only named office users decide a declaration; owners while
--      nobody is named (20261022170200)
--   K  a worker who is already staff, with a rejected declaration from
--      onboarding: Reverse rejection, and Update your declaration (which
--      pauses their shifts, as any declaration from the app does)
--   L  QA review (20261022170300): no direct write by any office session,
--      no free text in the audit log, a reversal lifts only the hold it
--      can prove, and /users keeps the fallback honest
--   M  security re-review (20261022170400): block fields only through the
--      functions, a rejection hold lifted only by a reviewer, no rejection
--      text left behind a removal, declare refused while an answer is owed
-- =====================================================================
begin;
select plan(149);
\ir _shared/fixtures.psql

\set cara      '91500000-0000-4000-8000-000000000001'
\set rob       '91500000-0000-4000-8000-000000000002'
\set rhea      '91500000-0000-4000-8000-000000000003'
\set wes       '91500000-0000-4000-8000-000000000004'
\set ivy       '91500000-0000-4000-8000-000000000005'
\set max       '91500000-0000-4000-8000-000000000006'
\set cara_uid  '91510000-0000-4000-8000-000000000001'
\set rob_uid   '91510000-0000-4000-8000-000000000002'
\set wes_uid   '91510000-0000-4000-8000-000000000004'
\set ivy_uid   '91510000-0000-4000-8000-000000000005'
\set viewer    '91510000-0000-4000-8000-0000000000a1'
\set scheduler '91510000-0000-4000-8000-0000000000a2'
\set manager   '91510000-0000-4000-8000-0000000000a3'
\set owner2    '91510000-0000-4000-8000-0000000000a4'
\set kim       '91500000-0000-4000-8000-000000000007'
\set lee       '91500000-0000-4000-8000-000000000008'
\set kim_uid   '91510000-0000-4000-8000-000000000007'
\set lee_uid   '91510000-0000-4000-8000-000000000008'
\set d_kim     '91520000-0000-4000-8000-000000000007'
\set d_lee     '91520000-0000-4000-8000-000000000008'
\set d_perm    '91520000-0000-4000-8000-000000000009'
\set b_lee     '91530000-0000-4000-8000-000000000008'
\set pat       '91500000-0000-4000-8000-000000000009'
\set quin      '91500000-0000-4000-8000-00000000000a'
\set ray       '91500000-0000-4000-8000-00000000000b'
\set sky       '91500000-0000-4000-8000-00000000000c'
\set d_pat     '91520000-0000-4000-8000-00000000000a'
\set d_quin    '91520000-0000-4000-8000-00000000000b'
\set tia       '91500000-0000-4000-8000-00000000000d'
\set tia_uid   '91510000-0000-4000-8000-00000000000d'
\set d_cara    '91520000-0000-4000-8000-000000000001'
\set d_rob     '91520000-0000-4000-8000-000000000002'
\set d_rhea    '91520000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'cara_uid', 'cara@decl915.test'), (:'rob_uid', 'rob@decl915.test'),
  (:'wes_uid', 'wes@decl915.test'), (:'ivy_uid', 'ivy@decl915.test'),
  (:'viewer', 'viewer@decl915.test'), (:'scheduler', 'scheduler@decl915.test'),
  (:'manager', 'manager@decl915.test'), (:'owner2', 'owner2@decl915.test'),
  (:'kim_uid', 'kim@decl915.test'), (:'lee_uid', 'lee@decl915.test');
insert into profiles (id, role, office_role, full_name) values
  (:'cara_uid', 'staff', null, 'Cara'), (:'rob_uid', 'staff', null, 'Rob'),
  (:'wes_uid', 'staff', null, 'Wes'), (:'ivy_uid', 'staff', null, 'Ivy'),
  (:'viewer', 'admin', 'viewer', 'Vera Viewer'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'manager', 'admin', 'manager', 'Richard Manager'),
  (:'owner2', 'admin', 'owner', 'Olive Owner'),
  (:'kim_uid', 'staff', null, 'Kim'), (:'lee_uid', 'staff', null, 'Lee');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'cara', :'cara_uid', null,  'Cara', 'Candidate', 'cara@decl915.test', '+447700915001', date '1999-01-01', 'documents', 'uk_irish'),
  (:'rob',  :'rob_uid',  null,  'Rob',  'Rejected',  'rob@decl915.test',  '+447700915002', date '1999-01-01', 'documents', 'uk_irish'),
  (:'rhea', null,        null,  'Rhea', 'Reversed',  'rhea@decl915.test', '+447700915003', date '1999-01-01', 'documents', 'uk_irish'),
  (:'wes',  :'wes_uid',  91504, 'Wes',  'Worker',    'wes@decl915.test',  '+447700915004', date '1990-01-01', 'compliant', 'uk_irish'),
  (:'ivy',  :'ivy_uid',  91505, 'Ivy',  'Worker',    'ivy@decl915.test',  '+447700915005', date '1990-01-01', 'compliant', 'uk_irish'),
  (:'max',  null,        91506, 'Max',  'Worker',    'max@decl915.test',  '+447700915006', date '1990-01-01', 'compliant', 'uk_irish');

-- The three candidates: a pending Yes, then everything else verified.
insert into criminal_declarations (id, staff_id, source, answer, details) values
  (:'d_cara', :'cara', 'onboarding', true, 'Caution, 2019'),
  (:'d_rob',  :'rob',  'onboarding', true, 'Fine'),
  (:'d_rhea', :'rhea', 'onboarding', true, 'Driving offence, 2021 — fined');
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
select s, 'passport', s || '/passport.pdf', 'verified'
  from unnest(array[:'cara', :'rob', :'rhea']::uuid[]) s;

-- The office's admin, as the fixtures make it (an owner).
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

-- =====================================================================
-- A · candidate: ask, answer, verify
-- =====================================================================
select throws_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_cara', '  '),
  'P0001', 'message_required', 'asking needs the message the worker is sent');

select is(compliance_request_declaration_details(:'d_cara',
            'Please tell us the date of the conviction and the sentence.') ->> 'status',
  'details_requested', 'Ask for more details closes the pending Yes as details_requested');
select is((select row(review_status::text, reviewed_by::text, worker_message, review_note)::text
             from criminal_declarations where id = :'d_cara'),
  row('details_requested', :'admin_uid', 'Please tell us the date of the conviction and the sentence.', null::text)::text,
  'the reviewer is stamped and the message is kept apart from the (empty) internal review note');

select is((select row(template, channel, recipient_staff_id::text, payload ->> 'link',
                      payload ->> 'message', payload ->> 'declarationId')::text
             from notification_outbox where key = 'DR1:declaration:' || :'d_cara'),
  row('DR1', 'push', :'cara', '/onboarding',
      'Please tell us the date of the conviction and the sentence.', :'d_cara')::text,
  'DR1 is queued to the candidate, keyed on the declaration, landing on the onboarding screen');
select ok((select not (payload ? 'details') and payload::text not like '%Caution%'
             from notification_outbox where key = 'DR1:declaration:' || :'d_cara'),
  'the push carries the office''s message only — never what was declared');

select throws_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_cara', 'again'),
  'P0001', 'not_pending: details_requested', 'a declaration is asked about once: the answer is a new one');
select throws_ok(format('select compliance_verify_declaration(%L)', :'d_cara'),
  'P0001', 'not_pending', 'Verify still refuses anything not pending');
select throws_ok(format('select compliance_reject_declaration(%L, %L)', :'d_cara', 'no'),
  'P0001', 'not_pending', 'and so does Reject');

select is_empty(format($$ select 1 from compliance_review_queue_v where item_id = %L $$, :'d_cara'),
  'it leaves Needs review while the office waits for the worker');
select ok('conviction_unreviewed' = any(onboarding_quiz_blockers(:'cara'))
          and (select status::text from staff where id = :'cara') = 'documents',
  'and the quiz gate holds on it, with the passport verified');

-- The candidate's side.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'cara_uid', 'role', 'authenticated')::text, true);
select is((select row(m ->> 'status', m ->> 'message', (m ->> 'canUpdate')::boolean, m ? 'details',
                      m::text like '%Caution%')::text
             from (select my_declaration_update() m) x),
  row('details_requested', 'Please tell us the date of the conviction and the sentence.', true, false, false)::text,
  'the candidate reads the office''s message and may answer — never the details they declared');
select is_empty($$ select worker_message from criminal_declarations $$,
  'RLS: the worker still reads no declaration row directly, the new column included (ADR-0031)');
select is_empty($$ select 1 from staff_declarations_v $$,
  'nor through the office''s view');
select is(update_my_declaration('   ', null) ->> 'reason', 'details_required',
  'the update needs the details, as the original did');
select is(update_my_declaration('More', ((now() at time zone 'Europe/London')::date + 1)) ->> 'reason',
  'conviction_date_in_future', 'and refuses a conviction date in the future');
select is(update_my_declaration(repeat('x', 4001), null) ->> 'reason', 'details_too_long',
  'and holds the 4,000-character bound');
select ok((update_my_declaration('Caution, March 2019, Metropolitan Police — no further action', date '2019-03-04') ->> 'ok')::boolean,
  'the candidate sends an updated declaration');
select is(update_my_declaration('Again', null) ->> 'reason', 'not_eligible',
  'and cannot send another while that one waits for review');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

select is((select row(superseded, review_status::text, details, worker_message)::text
             from criminal_declarations where id = :'d_cara'),
  row(true, 'details_requested', 'Caution, 2019', 'Please tell us the date of the conviction and the sentence.')::text,
  'the old declaration is superseded, its content and review untouched (§1.5)');
select id as d_cara2 from criminal_declarations where replaces_declaration_id = :'d_cara' \gset
select is((select row(review_status::text, source::text, answer, superseded, details, conviction_date)::text
             from criminal_declarations where id = :'d_cara2'),
  row('pending', 'onboarding', true, false, 'Caution, March 2019, Metropolitan Police — no further action', date '2019-03-04')::text,
  'the new one is pending, from onboarding, carrying the new details and pointing at the one it answers');
select ok(exists (select 1 from compliance_review_queue_v where item_id = :'d_cara2' and kind = 'declaration'),
  'it is back in Needs review');
select is((select row(previous_status::text, previous_worker_message)::text
             from staff_declarations_v where id = :'d_cara2'),
  row('details_requested', 'Please tell us the date of the conviction and the sentence.')::text,
  'the office reads it beside the question it answers');
select ok(exists (select 1 from audit_log where action = 'declaration.updated' and entity_id = :'d_cara2'),
  'the update is in the activity log');

select lives_ok(format('select compliance_verify_declaration(%L)', :'d_cara2'),
  'the office verifies the updated declaration');
select is((select status::text from staff where id = :'cara'), 'quiz',
  'and the candidate moves on to the quiz by themselves (§2.3)');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'cara_uid', 'role', 'authenticated')::text, true);
select is((select row(m ->> 'status', m ->> 'message', (m ->> 'canUpdate')::boolean)::text
             from (select my_declaration_update() m) x),
  row('verified', null::text, false)::text,
  'afterwards there is nothing to answer, and no message');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

-- =====================================================================
-- B · candidate: Reject, then answer the rejection
-- =====================================================================
select lives_ok(format('select compliance_reject_declaration(%L, %L)', :'d_rob', 'Internal: details too thin'),
  'the office rejects Rob''s declaration');
select is((select payload ->> 'link' from notification_outbox where key = 'N8:declaration:' || :'d_rob'),
  '/onboarding', 'N8 goes to the onboarding screen, where the update form now is');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'rob_uid', 'role', 'authenticated')::text, true);
select is((select row(m ->> 'status', m ->> 'message', (m ->> 'canUpdate')::boolean,
                      m::text like '%Internal%')::text
             from (select my_declaration_update() m) x),
  row('rejected', null::text, true, false)::text,
  'a rejected candidate may answer, and never reads the office''s review note');
select ok((update_my_declaration('Fine, 2018, for littering — paid', null) ->> 'ok')::boolean,
  'Rob sends an updated declaration');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select ok(not ('conviction_rejected' = any(onboarding_quiz_blockers(:'rob')))
          and 'conviction_unreviewed' = any(onboarding_quiz_blockers(:'rob')),
  'the gate now waits on the new pending declaration instead of conviction_rejected');
select ok(exists (select 1 from compliance_review_queue_v q
                   join criminal_declarations c on c.id = q.item_id
                  where c.replaces_declaration_id = :'d_rob' and c.review_status = 'pending'),
  'and it is in Needs review');

-- =====================================================================
-- C · candidate: Reverse rejection
-- =====================================================================
select lives_ok(format('select compliance_reject_declaration(%L, %L)', :'d_rhea', 'Not enough detail'),
  'the office rejects Rhea''s declaration');
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_rhea', ''),
  'P0001', 'note_required', 'a reversal needs its note');
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_cara2', 'x'),
  'P0001', 'not_rejected: verified', 'only a rejected declaration is reversed');
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_rob', 'x'),
  'P0001', 'not_rejected: superseded', 'and only the latest: one already answered is history');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer')::text, true);
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_rhea', 'Cleared'),
  '42501', 'read_only', 'a viewer cannot reverse a rejection (ADR-0060)');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler')::text, true);
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_rhea', 'Cleared'),
  '42501', 'not_criminal_records_reviewer',
  'a scheduler not named to review criminal records cannot (owners decide while nobody is named)');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is(admin_set_criminal_records_reviewer(:'scheduler', true) ->> 'changed', 'true',
  'an owner names the scheduler on /users');
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler')::text, true);
select is(compliance_reverse_declaration_rejection(:'d_rhea', 'Reviewed by Sam and Richard, cleared to work') ->> 'advanced',
  'true', 'named, the scheduler reverses it; the candidate moves on');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is(admin_set_criminal_records_reviewer(:'scheduler', false) ->> 'changed', 'true',
  'and the owner takes it away again: owners decide once more');
select is((select row(review_status::text, reviewed_by::text, review_note, reversed_rejection_reason,
                      reversed_at is not null)::text
             from criminal_declarations where id = :'d_rhea'),
  row('verified', :'scheduler', 'Reviewed by Sam and Richard, cleared to work', 'Not enough detail', true)::text,
  'verified by the one who reversed it, with their note; the rejection''s reason kept beside it');
select is((select status::text from staff where id = :'rhea'), 'quiz',
  'the conviction_rejected blocker is gone and onboarding_advance_if_ready moved her on');
select is((select row(data ->> 'rejectedBy', data ->> 'reversedBy', actor::text)::text from audit_log
            where action = 'declaration.rejection_reversed' and entity_id = :'d_rhea'),
  row(:'admin_uid', :'scheduler', :'scheduler')::text,
  'audited — who rejected it and who reversed it, never the texts');
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_rhea', 'again'),
  'P0001', 'not_rejected: verified', 'a reversal is not repeated');

-- =====================================================================
-- D · worker: ask while paused, answer, verify
-- =====================================================================
select (declare_conviction(:'wes', 'Speeding, 2026', null, now()) ->> 'declarationId') as d_wes \gset
select is((select status::text || '/' || block_kind::text from staff where id = :'wes'),
  'blocked/conviction_review', '§10.7: declaring pauses the worker');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer')::text, true);
select throws_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_wes', 'More?'),
  '42501', 'read_only', 'a viewer cannot ask either');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

select is(compliance_request_declaration_details(:'d_wes', 'What was the sentence?') ->> 'status',
  'details_requested', 'the office asks Wes for more details');
select is((select status::text || '/' || block_kind::text from staff where id = :'wes'),
  'blocked/conviction_review', 'the review block stays exactly as it was');
select is((select payload ->> 'link' from notification_outbox where key = 'DR1:declaration:' || :'d_wes'),
  '/documents/declare', 'DR1 lands a worker on the declaration form under Documents');
select ok(not unblock_if_compliant(:'wes')
          and exists (select 1 from compliance_blockers(:'wes') where reason = 'conviction_unreviewed'),
  'nothing lifts the block meanwhile: the request blocks as a pending review does');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'wes_uid', 'role', 'authenticated')::text, true);
select ok((my_declaration_update() ->> 'canUpdate')::boolean, 'Wes may answer');
select ok((update_my_declaration('Speeding, 2026 — six points, £400 fine', date '2026-06-01') ->> 'ok')::boolean,
  'and does');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select id as d_wes2 from criminal_declarations where replaces_declaration_id = :'d_wes' \gset
select is((select row(o.superseded, n.review_status::text, n.source::text)::text
             from criminal_declarations o, criminal_declarations n
            where o.id = :'d_wes' and n.id = :'d_wes2'),
  row(true, 'pending', 'in_employment')::text,
  'the old one superseded, the new one pending, from employment');
select is((select row(s.status::text, s.block_kind::text,
                      (select count(*)::int from notification_outbox where template = 'E9'
                          and payload ->> 'employeeId' = '91504'))::text
             from staff s where s.id = :'wes'),
  row('blocked', 'conviction_review', 2)::text,
  'still paused; the office hears of the answer by E9, as of any declaration from the app');
select lives_ok(format('select compliance_verify_declaration(%L)', :'d_wes2'), 'the office verifies it');
select is((select status::text from staff where id = :'wes'), 'compliant', 'the re-check lifts the block');
select ok(exists (select 1 from notification_outbox where key = 'N15:declaration:' || :'d_wes2'),
  'and N15 tells Wes their shifts are open again');

-- =====================================================================
-- E · worker: Reject makes a manual hold; Reverse lifts that hold
-- =====================================================================
select (declare_conviction(:'ivy', 'Theft, 2026', null, now()) ->> 'declarationId') as d_ivy \gset
select lives_ok(format('select compliance_reject_declaration(%L, %L)', :'d_ivy', 'Not enough detail'),
  'the office rejects Ivy''s declaration');
select is((select status::text || '/' || block_kind::text || '/' || block_reason from staff where id = :'ivy'),
  'blocked/manual/Declared conviction not accepted',
  '§10.7: the block hardens into a manual one — with fixed words, never the reviewer''s note');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ivy_uid', 'role', 'authenticated')::text, true);
select is(update_my_declaration('More detail', null) ->> 'reason', 'not_eligible',
  'a manual hold has nothing in the app behind it: no update in employment after a rejection');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

select is((select row(r ->> 'liftedHold', r ->> 'unblocked', r ->> 'status')::text
             from (select compliance_reverse_declaration_rejection(:'d_ivy', 'Spoke to Ivy — cleared to work') r) x),
  row('true', 'true', 'compliant')::text,
  'the reversal lifts the hold the rejection made and the ordinary re-check unblocks her');
select ok(exists (select 1 from notification_outbox where key = 'N15:declaration:' || :'d_ivy'),
  'with N15');

-- =====================================================================
-- F · a manager's own manual block is not the rejection's
-- =====================================================================
select (declare_conviction(:'max', 'Assault, 2026', null, now()) ->> 'declarationId') as d_max \gset
select compliance_reject_declaration(:'d_max', 'Not accepted');
select block_worker_manually(:'max', 'Timesheet dispute — call Richard');
select is((select row(r ->> 'liftedHold', r ->> 'unblocked')::text
             from (select compliance_reverse_declaration_rejection(:'d_max', 'Cleared') r) x),
  row('false', 'false')::text,
  'reversing the rejection leaves a block the manager put on for something else');
select is((select row(c.review_status::text, s.status::text, s.block_kind::text, s.block_reason)::text
             from criminal_declarations c join staff s on s.id = c.staff_id where c.id = :'d_max'),
  row('verified', 'blocked', 'manual', 'Timesheet dispute — call Richard')::text,
  'the declaration is verified; the manager''s block and reason stand');

-- =====================================================================
-- G · the guard, for every role including the table owner
-- =====================================================================
select throws_ok(format($$ update criminal_declarations set review_status = 'pending' where id = %L $$, :'d_cara'),
  'P0001', 'illegal_declaration_transition', 'details_requested is terminal');
select throws_ok(format($$ update criminal_declarations set review_status = 'rejected' where id = %L $$, :'d_cara2'),
  'P0001', 'illegal_declaration_transition', 'and so is verified');
select throws_ok(format($$ update criminal_declarations set review_status = 'verified' where id = %L $$, :'d_rob'),
  'P0001', 'reversal_note_required', 'rejected → verified is a reversal or nothing');
select throws_ok(format($$ update criminal_declarations set review_status = 'details_requested'
                            where replaces_declaration_id = %L $$, :'d_rob'),
  'P0001', 'message_required', 'a request for details is never a bare status change');
select throws_ok(format($$ update criminal_declarations set worker_message = 'rewritten' where id = %L $$, :'d_cara'),
  'P0001', 'declaration_never_edited', 'the message is written once');
select throws_ok(format($$ update criminal_declarations set replaces_declaration_id = null where id = %L $$, :'d_cara2'),
  'P0001', 'declaration_never_edited', 'and what an update answers never changes');
select throws_ok(format($$ update compliance_docs set review_status = 'details_requested'
                            where staff_id = %L $$, :'cara'),
  '23514', null, 'a document is never sent back: the status is the declaration''s alone');

-- =====================================================================
-- H · who reads and calls what
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is_empty($$ select worker_message, reversed_rejection_reason from criminal_declarations $$,
  'RLS: a client reads no declaration, the new columns included');
select is_empty($$ select 1 from staff_declarations_v $$, 'nor through the view');
select throws_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_wes2', 'x'),
  '42501', 'not_authorised', 'a client cannot ask');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_rob', 'x'),
  '42501', 'not_authorised', 'a worker cannot reverse');
select is(my_declaration_update() ->> 'status', 'verified',
  'a worker reads only their own latest declaration (Staff Alpha''s fixture No)');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select ok((select count(*) from staff_declarations_v
            where worker_message is not null or reversed_rejection_reason is not null) >= 4,
  'the office reads the messages and reversed rejections through admin_read');
reset role;

select ok(not has_function_privilege('anon', 'public.compliance_request_declaration_details(uuid,text)', 'execute')
          and not has_function_privilege('anon', 'public.compliance_reverse_declaration_rejection(uuid,text)', 'execute')
          and not has_function_privilege('anon', 'public.my_declaration_update()', 'execute')
          and not has_function_privilege('anon', 'public.update_my_declaration(text,date)', 'execute')
          and not has_function_privilege('authenticated', 'public.declaration_update_allowed(staff_status,block_kind,boolean,review_status)', 'execute')
          and not has_function_privilege('anon', 'public.admin_set_criminal_records_reviewer(uuid,boolean)', 'execute')
          and not has_function_privilege('anon', 'public.can_review_criminal_records()', 'execute')
          and not has_function_privilege('authenticated', 'public.assert_criminal_records_reviewer()', 'execute'),
  'anon reaches none of the new functions; the eligibility helper and the assert are nobody''s RPC');

-- =====================================================================
-- I · §1.7
-- =====================================================================
select set_config('request.jwt.claims', '', true);
select remove_worker(:'wes');
select is((select count(*)::int from criminal_declarations
            where staff_id = :'wes' and (worker_message is not null or reversed_rejection_reason is not null
                                          or details is not null)), 0,
  'a GDPR removal clears the office''s message with the details');
select is_empty(format($$ select 1 from notification_outbox where key = 'DR1:declaration:' || %L and sent_at is null $$, :'d_wes'),
  'and an unsent DR1 goes with the person');

-- =====================================================================
-- J · only named office users decide a declaration
-- =====================================================================
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'kim', :'kim_uid', 91507, 'Kim', 'Staff', 'kim@decl915.test', '+447700915007', date '1990-01-01', 'compliant', 'uk_irish'),
  (:'lee', :'lee_uid', 91508, 'Lee', 'Staff', 'lee@decl915.test', '+447700915008', date '1990-01-01', 'compliant', 'uk_irish');
-- Their declarations from onboarding, pending: Kim's and Lee's are decided below,
-- the third (on Max) is the one the permission is tried on.
insert into criminal_declarations (id, staff_id, source, answer, details) values
  (:'d_kim',  :'kim', 'onboarding', true, 'Caution, 2015'),
  (:'d_lee',  :'lee', 'onboarding', true, 'Fine, 2016'),
  (:'d_perm', :'max', 'in_employment', true, 'Second matter');

select set_config('request.jwt.claims', json_build_object('sub', :'manager')::text, true);
select throws_ok(format('select admin_set_criminal_records_reviewer(%L, true)', :'manager'),
  '42501', 'not_permitted', 'only an owner names who may decide (a manager cannot, even for themselves)');
select ok(not can_review_criminal_records(), 'a manager does not decide while nobody is named');
select throws_ok(format('select compliance_verify_declaration(%L)', :'d_perm'),
  '42501', 'not_criminal_records_reviewer', 'nor can they Verify');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select throws_ok(format('select admin_set_criminal_records_reviewer(%L, true)', :'viewer'),
  'P0001', 'viewer_cannot_review', 'a viewer cannot be named: they change nothing');
select throws_ok(format('select admin_set_criminal_records_reviewer(%L, true)', :'staffa_uid'),
  'P0001', 'not_office_login', 'nor a worker''s login');
select ok(can_review_criminal_records(), 'while nobody is named, an owner decides');
select lives_ok(format('select admin_set_criminal_records_reviewer(%L, true)', :'manager'),
  'the owner names Richard, a manager');
select is((select row(actor::text, data ->> 'to')::text from audit_log
            where action = 'account.criminal_records_granted' and entity_id = :'manager'),
  row(:'admin_uid', 'true')::text, 'the change is audited, with who made it');
select ok(:'manager' = any (select jsonb_array_elements_text(admin_criminal_records_reviewers())),
  '/users lists who is named');

select ok(not can_review_criminal_records(), 'now that someone is named, an owner who is not cannot decide');
select throws_ok(format('select compliance_reject_declaration(%L, %L)', :'d_perm', 'no'),
  '42501', 'not_criminal_records_reviewer', 'an un-named owner cannot Reject');
select throws_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_perm', 'more'),
  '42501', 'not_criminal_records_reviewer', 'nor Ask for more details');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler')::text, true);
select throws_ok(format('select compliance_verify_declaration(%L)', :'d_perm'),
  '42501', 'not_criminal_records_reviewer', 'a scheduler who is not named is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'manager')::text, true);
select ok(can_review_criminal_records(), 'the named manager may decide');
select throws_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_perm', 'Which court?'),
  'P0001', 'cannot_answer_from_app: blocked',
  'but not ask someone on a manual hold for details: they cannot answer from the app — the office calls them');
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'pat', 91509, 'Pat', 'Staff', 'pat@decl915.test', '+447700915009', date '1990-01-01', 'compliant', 'uk_irish');
insert into criminal_declarations (id, staff_id, source, answer, details) values
  (:'d_pat', :'pat', 'onboarding', true, 'Old matter');
select lives_ok(format('select compliance_request_declaration_details(%L, %L)', :'d_pat', 'Which court?'),
  'and asks a compliant worker for more details');

-- The named one switched off: nobody working holds it, so owners decide again.
update auth.users set banned_until = now() + interval '100 years' where id = :'manager';
select set_config('request.jwt.claims', json_build_object('sub', :'owner2')::text, true);
select ok(can_review_criminal_records(),
  'with the only named login switched off, owners decide — nothing locks up');
update auth.users set banned_until = null where id = :'manager';
select ok(not can_review_criminal_records(), 'and when it is switched back on, they do not');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'kim_uid', 'role', 'authenticated')::text, true);
select ok(not can_review_criminal_records(), 'a worker never decides');
select throws_ok(format('select compliance_verify_declaration(%L)', :'d_kim'),
  '42501', 'not_authorised', 'and is refused before that');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select ok(not can_review_criminal_records(), 'nor does a client');
reset role;

-- =====================================================================
-- K · already staff, with a rejected declaration from onboarding
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'manager')::text, true);
select lives_ok(format('select compliance_reject_declaration(%L, %L)', :'d_kim', 'Need the sentence'),
  'Kim''s onboarding declaration is rejected while she is already staff');
select lives_ok(format('select compliance_reject_declaration(%L, %L)', :'d_lee', 'Need the sentence'),
  'and Lee''s');
select is((select status::text from staff where id = :'kim'), 'compliant',
  'an onboarding rejection makes no block: they are still compliant');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'kim_uid', 'role', 'authenticated')::text, true);
select is((select row(m ->> 'status', (m ->> 'canUpdate')::boolean, (m ->> 'pausesShifts')::boolean)::text
             from (select my_declaration_update() m) x),
  row('rejected', true, true)::text,
  'staff with a rejected declaration may update it from Documents — and are told it pauses their shifts');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'manager')::text, true);
select is((select row(r ->> 'status', r ->> 'liftedHold')::text
             from (select compliance_reverse_declaration_rejection(:'d_kim', 'Cleared after a call') r) x),
  row('compliant', 'false')::text,
  'Reverse rejection works for staff: verified, still compliant, nothing to lift');
select is((select review_status::text from criminal_declarations where id = :'d_kim'), 'verified',
  'Kim''s declaration is verified');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'b_lee', :'shift_a', :'lee', 'confirmed', 'manual', now());
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'lee_uid', 'role', 'authenticated')::text, true);
select is((select row((r ->> 'ok')::boolean, (r ->> 'paused')::boolean, (r ->> 'released')::int)::text
             from (select update_my_declaration('Fine, 2016 — £200, paid in full', null) r) x),
  row(true, true, 1)::text,
  'Lee updates it: as any declaration from the app, it pauses his shifts and releases the booked one');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'manager')::text, true);
select id as d_lee2 from criminal_declarations where replaces_declaration_id = :'d_lee' \gset
select is((select row(c.source::text, c.review_status::text, s.status::text, s.block_kind::text,
                      (select status::text from bookings where id = :'b_lee'))::text
             from criminal_declarations c join staff s on s.id = c.staff_id where c.id = :'d_lee2'),
  row('in_employment', 'pending', 'blocked', 'conviction_review', 'cancelled')::text,
  'the update is an in-employment declaration under review; Lee is paused for it');
select ok(exists (select 1 from notification_outbox where key = 'E9:declaration:' || :'d_lee2'),
  'and the office gets E9, as for any declaration from the app');
select lives_ok(format('select compliance_verify_declaration(%L)', :'d_lee2'), 'the named manager verifies it');
select is((select row(s.status::text,
                      exists (select 1 from notification_outbox where key = 'N15:declaration:' || :'d_lee2'))::text
             from staff s where s.id = :'lee'),
  row('compliant', true)::text, 'Lee is unblocked and told his shifts are open again');

-- =====================================================================
-- L · QA review: the doors, the log, the provenance, the fallback
-- =====================================================================
-- B1 · no office session writes the table, named or not.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select throws_ok(format($$ update criminal_declarations set review_status = 'verified' where id = %L $$, :'d_perm'),
  '42501', null, 'a manager or scheduler who is not named cannot PATCH a declaration verified');
select throws_ok(format($$ insert into criminal_declarations (staff_id, source, answer) values (%L, 'in_employment', false) $$, :'max'),
  '42501', null, 'nor insert one');
select throws_ok(format($$ delete from criminal_declarations where id = %L $$, :'d_perm'),
  '42501', null, 'nor delete one');
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select throws_ok(format($$ update criminal_declarations set review_status = 'rejected', review_note = 'x' where id = %L $$, :'d_perm'),
  '42501', null, 'and even a named reviewer decides only through the functions');
select throws_ok(format($$ update criminal_declarations set superseded = true where id = %L $$, :'d_perm'),
  '42501', null, 'nor marks one superseded');
select ok(exists (select 1 from staff_declarations_v where id = :'d_perm'),
  'the office still reads every declaration');
reset role;
select is((select review_status::text from criminal_declarations where id = :'d_perm'), 'pending',
  'and the declaration is untouched');

-- B2 · the reversal's audit row says who and when, never the texts.
select ok((select not (data ?| array['note', 'rejectionReason', 'reason', 'message'])
                  and data ? 'reversedBy' and data ? 'rejectedBy'
             from audit_log where action = 'declaration.rejection_reversed' and entity_id = :'d_ivy'),
  'declaration.rejection_reversed carries no note and no rejection reason');
select ok(not exists (select 1 from audit_log
                       where entity = 'criminal_declaration'
                         and data ?| array['note', 'rejectionReason', 'reason', 'message', 'details']),
  'no declaration audit row this file wrote carries free text');
insert into audit_log (actor, action, entity, entity_id, data)
values (:'admin_uid', 'declaration.rejection_reversed', 'criminal_declaration', :'d_ivy',
        jsonb_build_object('staffId', :'ivy', 'note', 'Spoke to Ivy about the theft', 'rejectionReason', 'Theft'));
select set_config('request.jwt.claims', '', true);
select remove_worker(:'ivy');
select ok(not exists (select 1 from audit_log
                       where entity = 'criminal_declaration' and data ->> 'staffId' = :'ivy'
                         and data ?| array['note', 'rejectionReason']),
  'and a GDPR removal strips any that ever did');

-- B3 · the rejection's own hold, proven — not a block with the same words.
select set_config('request.jwt.claims', json_build_object('sub', :'manager')::text, true);
select is((select rejection_hold_at is not null from criminal_declarations where id = :'d_ivy'), true,
  'an in-employment rejection that made the hold is stamped with it');
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'quin', 91510, 'Quin', 'Staff', 'quin@decl915.test', '+447700915010', date '1990-01-01', 'compliant', 'uk_irish'),
  (:'ray',  91511, 'Ray',  'Staff', 'ray@decl915.test',  '+447700915011', date '1990-01-01', 'compliant', 'uk_irish'),
  (:'sky',  91512, 'Sky',  'Staff', 'sky@decl915.test',  '+447700915012', date '1990-01-01', 'compliant', 'uk_irish');
insert into criminal_declarations (id, staff_id, source, answer, details) values
  (:'d_quin', :'quin', 'onboarding', true, 'Old matter');
select compliance_reject_declaration(:'d_quin', 'Need the sentence');
select block_worker_manually(:'quin', 'Declared conviction not accepted');
select r ->> 'liftedHold' as quin_lift, coalesce(r ->> 'stillBlockedFor', '') as quin_for
  from (select compliance_reverse_declaration_rejection(:'d_quin', 'Cleared') r) x \gset
select is((select row(:'quin_lift', s.status::text, s.block_kind::text, s.block_reason)::text
             from staff s where s.id = :'quin'),
  row('false', 'blocked', 'manual', 'Declared conviction not accepted')::text,
  'an onboarding rejection on staff never lifts a manager''s block, even one with the same words');

select (declare_conviction(:'ray', 'Matter, 2026', null, now()) ->> 'declarationId') as d_ray \gset
select compliance_reject_declaration(:'d_ray', 'Not enough detail');
select unblock_worker(:'ray');
select block_worker_manually(:'ray', 'Declared conviction not accepted');
select r ->> 'liftedHold' as ray_lift, coalesce(r ->> 'stillBlockedFor', '') as ray_for
  from (select compliance_reverse_declaration_rejection(:'d_ray', 'Cleared') r) x \gset
select is((select row(:'ray_lift', s.status::text, s.block_kind::text)::text
             from staff s where s.id = :'ray'),
  row('false', 'blocked', 'manual')::text,
  'nor one a manager put back after unblocking them, words and all: the hold is no longer the rejection''s');

insert into compliance_docs (staff_id, doc_type, file_path, review_status, expiry_date)
values (:'sky', 'passport', 'sky/passport.pdf', 'verified', (now() at time zone 'Europe/London')::date - 1);
select (declare_conviction(:'sky', 'Matter, 2026', null, now()) ->> 'declarationId') as d_sky \gset
select compliance_reject_declaration(:'d_sky', 'Not enough detail');
select r ->> 'liftedHold' as sky_lift, coalesce(r ->> 'stillBlockedFor', '') as sky_for
  from (select compliance_reverse_declaration_rejection(:'d_sky', 'Cleared') r) x \gset
select is((select row(:'sky_lift', :'sky_for', s.status::text, s.block_kind::text)::text
             from staff s where s.id = :'sky'),
  row('true', 'documents', 'blocked', 'auto_document')::text,
  'the rejection''s own hold is lifted, and what still holds them is the expired passport — never a false "under review"');

-- N3 · /users keeps the fallback honest.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select throws_ok(format('select compliance_reverse_declaration_rejection(%L, %L)', :'d_perm', 'x'),
  '42501', 'not_criminal_records_reviewer', 'while someone is named, an owner who is not cannot Reverse either');
update auth.users set banned_until = now() + interval '100 years' where id = :'scheduler';
select throws_ok(format('select admin_set_criminal_records_reviewer(%L, true)', :'scheduler'),
  'P0001', 'login_disabled', 'a switched-off login cannot be named');
update auth.users set banned_until = null where id = :'scheduler';
select lives_ok(format('select admin_set_office_role(%L, %L)', :'manager', 'viewer'),
  'the owner makes Richard a viewer');
select is((select reviews_criminal_records from profiles where id = :'manager'), false,
  'a viewer loses the permission');
select ok(exists (select 1 from audit_log where action = 'account.criminal_records_revoked'
                   and entity_id = :'manager' and data ->> 'because' = 'became_viewer'),
  'and the log says so');
select ok(can_review_criminal_records(), 'with nobody named any more, owners decide again');

-- =====================================================================
-- M · security re-review
-- =====================================================================
-- H1 · the block columns, only through the functions.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select throws_ok(format($$ update staff set block_kind = 'auto_document', block_reason = null where id = %L $$, :'ray'),
  '42501', 'staff_block_rpc_only', 'a scheduler cannot PATCH a rejection hold into a document block');
select set_config('request.jwt.claims', json_build_object('sub', :'owner2', 'role', 'authenticated')::text, true);
select throws_ok(format($$ update staff set block_reason = 'Something else' where id = %L $$, :'ray'),
  '42501', 'staff_block_rpc_only', 'nor can an owner rewrite a block''s reason directly');
reset role;
select is((select block_kind::text from staff where id = :'ray'), 'manual', 'Ray''s block is untouched');

-- H1 · Unblock leaves a rejection's hold to a criminal-records reviewer.
insert into auth.users (id, email) values (:'tia_uid', 'tia@decl915.test');
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'tia', :'tia_uid', 91513, 'Tia', 'Staff', 'tia@decl915.test', '+447700915013', date '1990-01-01', 'compliant', 'uk_irish');
select (declare_conviction(:'tia', 'Theft of a laptop, 2026', null, now()) ->> 'declarationId') as d_tia \gset
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select compliance_reject_declaration(:'d_tia', 'Theft of a laptop — not disclosed at interview');
select is((select block_reason from staff where id = :'tia'), 'Declared conviction not accepted',
  'H2: the hold carries the fixed words, not the reviewer''s note');
select is(declaration_rejection_hold(:'tia'), :'d_tia'::uuid, 'and it is recognised as the rejection''s hold');
select set_config('request.jwt.claims', '', true);
select throws_ok(format('select unblock_worker(%L, current_date, %L)', :'tia', :'scheduler'),
  '42501', 'criminal_records_reviewer_only',
  'a scheduler who may not decide criminal declarations cannot Unblock a rejection''s hold');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select admin_set_criminal_records_reviewer(:'owner2', true);
select set_config('request.jwt.claims', '', true);
select throws_ok(format('select unblock_worker(%L, current_date, %L)', :'tia', :'admin_uid'),
  '42501', 'criminal_records_reviewer_only', 'nor an owner who is not named, once someone is');
select is(unblock_worker(:'tia', current_date, :'owner2') ->> 'unblocked', 'true',
  'the named reviewer may');
select is((select status::text from staff where id = :'tia'), 'compliant', 'Tia is compliant');
select is((select data ->> 'reason' from audit_log where action = 'unblock' and entity_id = :'tia'),
  'Declared conviction not accepted', 'the unblock audit row names the fixed words only');
select ok(unblock_worker(:'ray', current_date, :'scheduler') is not null,
  'a manager''s own block (Ray''s, put back after an unblock) is anyone''s to lift');

-- H2 · nothing of the rejection's text survives a removal.
select block_worker_manually(:'tia', 'Timesheet dispute — call Richard', now(), :'owner2');
-- An Unblock row from before 20261022170400, when a rejection's note
-- became the block's reason and so the unblock row's.
insert into audit_log (at, actor, action, entity, entity_id, data)
values (now() - interval '1 day', :'owner2', 'unblock', 'staff', :'tia',
        jsonb_build_object('blockKind', 'manual', 'reason', 'Theft of a laptop — not disclosed'));
select set_config('request.jwt.claims', '', true);
select remove_worker(:'tia');
select is_empty(format($$ select 1 from audit_log
                           where (entity_id = %L or data ->> 'staffId' = %L)
                             and data::text like '%%laptop%%' $$, :'tia', :'tia'),
  'after a GDPR removal no audit row about Tia carries the rejection''s words');
select is((select data ->> 'reason' from audit_log where action = 'block_manual' and entity_id = :'tia'),
  'Timesheet dispute — call Richard', 'while a manager''s own block reason stays the office''s record (ADR-0039)');
select is_empty(format($$ select 1 from criminal_declarations
                           where staff_id = %L and (review_note is not null or details is not null) $$, :'tia'),
  'and the declaration''s own texts are gone');

-- Low · while the office waits for an answer, the answer is the update.
insert into auth.users (id, email) values ('91510000-0000-4000-8000-000000000009', 'pat@decl915.test');
update staff set user_id = '91510000-0000-4000-8000-000000000009' where id = :'pat';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '91510000-0000-4000-8000-000000000009', 'role', 'authenticated')::text, true);
select is(declare_my_conviction('Another matter', null) ->> 'reason', 'update_instead',
  'a worker the office asked for more details answers with Update your declaration, not a second declaration');
select is(has_table_privilege('authenticated', 'public.criminal_declarations', 'select')
          and not has_table_privilege('authenticated', 'public.criminal_declarations', 'update')
          and not has_table_privilege('anon', 'public.criminal_declarations', 'select'),
  true, 'criminal_declarations: authenticated may only SELECT (admin_read decides the rows); anon nothing');
reset role;

select * from finish();
rollback;
