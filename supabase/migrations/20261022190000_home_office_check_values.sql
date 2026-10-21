-- =====================================================================
-- A sixth right-to-work branch: the Home Office Employer Checking Service
-- (ADR-0182) — the two enum values only
--
-- THC, 21.10.2026: some workers (mostly people claiming asylum, and anyone
-- with a pending application or appeal or on section 3C leave) have no
-- share code. Their right to work is confirmed by the Home Office's
-- Employer Checking Service: the office fills in the online form and the
-- result comes back by email as a PDF, usually valid for six months.
--
--   rtw_branch 'home_office_check'      — the branch the worker picks at
--                                         step 1 (or the office moves them to)
--   doc_type  'home_office_check_result' — the result the OFFICE attaches;
--                                         its typed "right to work until"
--                                         is the worker's right-to-work date
--
-- `alter type … add value` cannot be used in the transaction that adds it,
-- so every rule that reads the two values is in the next migration,
-- 20261022190100.
-- =====================================================================

alter type public.rtw_branch add value if not exists 'home_office_check' after 'dependant_other';
alter type public.doc_type add value if not exists 'home_office_check_result' after 'share_code_report';
