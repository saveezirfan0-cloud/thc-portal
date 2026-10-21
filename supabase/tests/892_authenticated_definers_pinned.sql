-- =====================================================================
-- 892 · every SECURITY DEFINER function a signed-in caller can execute,
--       pinned by name · ADR-0163 · security review L5
--
-- A definer runs with the owner's rights, which on this schema means past
-- every RLS policy in it; its own body is the only thing deciding what it
-- does for whom. 190 · 2e pins the set anon can reach (two functions).
-- This pins the set `authenticated` can reach — the product's RPC surface,
-- 202 functions on 22.10.2026 (189 + ADR-0164's two + main's remove_shift_sections and set_staff_passport_country + ADR-0168's onboarding_grant_quiz_attempts + ADR-0172's five invoice functions + ADR-0176's set_client_invoice_details, invoice_file and resend_invoice_email), docs/14 §4 — so a new one fails here BY
-- NAME until somebody has read its caller check and added it below in the
-- same PR. That is the whole point: the list is a review log, not a count.
--
-- What counts is exactly what the advisor and docs/14 count: `prosecdef`,
-- in public, not an extension member (PostGIS's st_estimatedextent
-- overloads are the live advisor's three extras, ADR-0131), and
-- has_function_privilege('authenticated', …). The signature is the
-- regprocedure under a fixed search_path, so an overload is a new line.
--
-- Adding one: check it resolves its caller in its own body (staff_caller,
-- assert_reviewer, assert_office_caller, office_can, current_app_role …),
-- revoke it from PUBLIC and anon (190 · 2f), add it here, and bump the
-- count in docs/14 §4. Removing one from authenticated: delete its line.
--
-- The second assertion is the same question for every other schema we
-- own: no definer outside public is reachable by a signed-in caller.
-- =====================================================================
begin;
select plan(2);
set local search_path = public, extensions;

select bag_eq(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  $$ values
            ('accept_application(uuid)'::text),
            ('accept_invite(uuid)'),
            ('account_invite_link_ok(text)'),
            ('acknowledge_shift_kit(uuid)'),
            ('add_my_unavailability(date,date,time without time zone,time without time zone,integer)'),
            ('admin_accounts(app_role)'),
            ('admin_activity(integer,bigint,text,uuid,text,timestamp with time zone)'),
            ('admin_activity_facets()'),
            ('admin_login_lookup(text)'),
            ('admin_record_history(text,uuid,integer,bigint)'),
            ('admin_register_account(uuid,app_role,text,uuid,text,office_role)'),
            ('admin_reset_two_step(uuid,text)'),
            ('admin_set_login_disabled(uuid,boolean,text)'),
            ('admin_set_office_role(uuid,office_role)'),
            ('apply_to_shift(uuid,uuid)'),
            ('approve_completion_letter(uuid,date,date)'),
            ('assert_reviewer()'),
            ('assert_role_rate_floor(uuid,numeric)'),
            ('attach_event_document_badges(uuid,text,text,integer)'),
            ('attempt_check_in(uuid,double precision,double precision,double precision)'),
            ('auto_assign_first_round(uuid)'),
            ('auto_assign_unavailable(uuid)'),
            ('bar_from_client(uuid,uuid,text)'),
            ('booking_payroll_exported(uuid)'),
            ('booking_venue_point(uuid)'),
            ('cancel_event(uuid,text)'),
            ('cancel_wtr_optout(uuid)'),
            ('check_out(uuid,double precision,double precision,double precision)'),
            ('clear_my_emergency_contact()'),
            ('client_request_worker(uuid,text)'),
            ('compliance_attach_rtw_report(uuid,text)'),
            ('compliance_confirm_rtw_date(uuid,date)'),
            ('compliance_reject_declaration(uuid,text)'),
            ('compliance_reject_document(uuid,text)'),
            ('compliance_resolve_ni_check(uuid,boolean,text)'),
            ('compliance_set_below_degree_level(uuid,boolean)'),
            ('compliance_set_visa_hour_limit(uuid,integer)'),
            ('compliance_verify_declaration(uuid,text)'),
            ('compliance_verify_document(uuid,date,daterange[],date)'),
            ('confirm_on_day(uuid)'),
            ('current_app_role()'),
            ('current_client_id()'),
            ('declare_my_conviction(text,date)'),
            ('decline_invite(uuid)'),
            ('event_document_data(uuid)'),
            ('finance_report(date,date,text)'),
            ('finish_break(uuid)'),
            ('forget_other_push_subscriptions(text)'),
            ('forget_push_subscription(text)'),
            ('invite_roster_report(timestamp with time zone)'),
            ('invoice_event_lines(uuid)'),
            ('invoice_event_violations(uuid)'),
            ('invoice_events(date,date)'),
            ('invoice_file(uuid)'),
            ('invoice_export_rows(date,date,uuid)'),
            ('invite_worker(uuid,uuid,booking_source,boolean)'),
            ('link_event_series(uuid,uuid)'),
            ('link_invite_roster_entry(uuid,uuid,boolean)'),
            ('load_invite_roster(jsonb)'),
            ('mark_client_worker_request_handled(uuid)'),
            ('mark_ready(uuid)'),
            ('minimum_pay_rate()'),
            ('my_emergency_contact()'),
            ('my_list_columns()'),
            ('my_profile_change_requests()'),
            ('my_referral_code()'),
            ('my_referral_summary()'),
            ('my_rtw_checks()'),
            ('my_time_format()'),
            ('my_unavailability(timestamp with time zone,timestamp with time zone)'),
            ('new_starter_report(date)'),
            ('office_can(text)'),
            ('office_clear_emergency_contact(uuid)'),
            ('office_correct_dob(uuid,date,text)'),
            ('office_decide_profile_change(uuid,boolean,text)'),
            ('office_decline_cover(uuid,text)'),
            ('office_emergency_contact(uuid)'),
            ('office_invite_worker(uuid,uuid)'),
            ('office_open_offer_to_pool(uuid)'),
            ('office_profile_change_requests(uuid,boolean,integer)'),
            ('office_reject_selfie(uuid,text)'),
            ('office_save_emergency_contact(uuid,text,text,text)'),
            ('office_session_policy()'),
            ('office_staff_referrals(uuid)'),
            ('office_staff_unavailability(uuid,timestamp with time zone,timestamp with time zone)'),
            ('office_submit_completion_letter(uuid,text,date,text,text)'),
            ('office_user_name(uuid)'),
            ('onboarding_accept_with_account(uuid,uuid[],text,uuid,text,text)'),
            ('onboarding_attach_document(text,text,text,integer,text)'),
            ('onboarding_chaser_state(timestamp with time zone)'),
            ('onboarding_complete_induction()'),
            ('onboarding_confirm_selfie()'),
            ('onboarding_finish_tutorial()'),
            ('onboarding_grant_quiz_attempts(uuid,text)'),
            ('onboarding_mark_interview_complete(uuid,text)'),
            ('onboarding_quiz_questions()'),
            ('onboarding_reenter_share_code(text,date)'),
            ('onboarding_reject(uuid,text)'),
            ('onboarding_resend_activation(uuid,uuid,text,text)'),
            ('onboarding_resend_activation_check(uuid)'),
            ('onboarding_resolve_returning(uuid,text,text)'),
            ('onboarding_save_bank(text,text,text)'),
            ('onboarding_save_references(jsonb)'),
            ('onboarding_save_right_to_work(text,date,text,text,date,text,boolean)'),
            ('onboarding_state()'),
            ('onboarding_submit_documents(boolean,text,date)'),
            ('password_check_allowed()'),
            ('password_check_begin()'),
            ('password_check_release(bigint)'),
            ('payroll_report(date,date)'),
            ('payroll_report_people(date,date)'),
            ('queue_account_invite(uuid,text)'),
            ('queue_event_document_email(uuid)'),
            ('queue_office_notifications(jsonb)'),
            ('reconfirm_booking(uuid)'),
            ('record_event_document(uuid,text,text,text,integer,integer)'),
            ('record_password_check_failure()'),
            ('record_ping(uuid,double precision,double precision,double precision)'),
            ('record_right_to_work_change(uuid,rtw_branch,date,text)'),
            ('reject_declaration(uuid,text)'),
            ('reject_document(uuid,text)'),
            ('remove_invite_roster_entries(uuid[])'),
            ('remove_my_unavailability(uuid,boolean)'),
            ('remove_shift_sections(uuid,uuid[])'),
            ('request_cover(uuid,text)'),
            ('request_dob_change(date,text,text)'),
            ('request_my_p45(text)'),
            ('request_profile_change(text,text,text,text,text,text)'),
            ('resend_invoice_email(uuid)'),
            ('reset_client_quiz_attempts(uuid,uuid)'),
            ('retry_finance_report(bigint)'),
            ('reviewer_name(uuid)'),
            ('rota_guard_mode()'),
            ('rtw_check_enabled()'),
            ('rtw_check_manual_allowed(uuid)'),
            ('rtw_check_mark_reviewed(uuid)'),
            ('rtw_check_request(uuid)'),
            ('rtw_check_stale_after()'),
            ('rtw_check_stuck(text,timestamp with time zone,timestamp with time zone,timestamp with time zone)'),
            ('save_my_emergency_contact(text,text,text)'),
            ('save_push_subscription(text,text,text,text,text)'),
            ('self_cancel_booking(uuid)'),
            ('send_event_message(uuid,uuid,text,text,uuid)'),
            ('send_staff_message(uuid[],text)'),
            ('set_client_lineup_emails(uuid,text,boolean)'),
            ('set_client_invoice_details(uuid,text,text[],text,text[])'),
            ('set_client_name_badges(uuid,boolean)'),
            ('set_do_not_return(uuid,boolean,text)'),
            ('set_event_document_recipients(uuid,text[])'),
            ('set_invite_roster_reminders(boolean)'),
            ('set_my_list_columns(text,jsonb)'),
            ('set_my_time_format(text)'),
            ('set_staff_gender(uuid,text)'),
            ('set_staff_languages(uuid,text[])'),
            ('set_staff_passport_country(uuid,text)'),
            ('set_staff_pay_rate(uuid,numeric)'),
            ('set_staff_payroll_id(uuid,text)'),
            ('set_staff_scheduling(uuid,boolean,boolean)'),
            ('sign_contract(text,boolean)'),
            ('sign_off_event_invoice(uuid,text,text)'),
            ('sign_wtr_optout(text,integer,uuid)'),
            ('staff_account_activated(uuid)'),
            ('staff_account_activated_at(uuid)'),
            ('staff_booking_offers()'),
            ('staff_bookings(uuid)'),
            ('staff_caller(uuid)'),
            ('staff_client_quiz(uuid)'),
            ('staff_documents(uuid)'),
            ('staff_earnings()'),
            ('staff_email_records(text,text,integer,integer,timestamp with time zone)'),
            ('staff_email_report(timestamp with time zone)'),
            ('staff_identity_facts(uuid)'),
            ('staff_me()'),
            ('staff_open_offers(uuid)'),
            ('staff_open_shifts(uuid,uuid)'),
            ('staff_save_bank(text,text,text)'),
            ('staff_save_languages(text[])'),
            ('staff_set_ni_number(text)'),
            ('staff_set_photo(text)'),
            ('staff_shift_detail(uuid)'),
            ('staff_shift_requirements()'),
            ('staff_sync_email()'),
            ('staff_update_contact(text,text)'),
            ('staff_week_meter(uuid)'),
            ('start_break(uuid)'),
            ('submit_client_feedback(uuid,integer,text)'),
            ('submit_client_quiz_attempt(uuid,jsonb)'),
            ('submit_completion_letter(text,date,text,text,uuid)'),
            ('submit_document_upload(text,text,text,uuid)'),
            ('submit_hmrc_checklist(boolean,boolean,boolean,text,boolean,text,boolean)'),
            ('submit_hmrc_checklist(boolean,boolean,boolean,text,boolean,text,boolean,text)'),
            ('submit_quiz_attempt(jsonb)'),
            ('submit_share_code_with_dob(text,date,text)'),
            ('take_offered_shift(uuid)'),
            ('update_my_profile(text,text,text)'),
            ('verify_declaration(uuid,text)'),
            ('verify_document(uuid,date,daterange[],date)'),
            ('void_violation(uuid,text)'),
            ('withdraw_application(uuid)'),
            ('withdraw_booking(uuid)'),
            ('withdraw_profile_change(uuid)'),
            ('withdraw_shift_offer(uuid)') $$,
  'the security definer functions a signed-in caller can execute are exactly these 202 — a new one is a reviewed addition (ADR-0163, docs/14 §4)'
);

select is_empty(
  $$ select n.nspname || '.' || p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        -- This project's own schemas (private, …): the migrations create them
        -- as postgres. Supabase's (auth, storage, supabase_functions, …)
        -- belong to its service roles and are the platform's to answer for.
        and n.nspowner = 'postgres'::regrole
        and n.nspname not in ('public', 'pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_'
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'and no security definer in any other schema (private, …) is executable by a signed-in caller'
);

select * from finish();
rollback;
