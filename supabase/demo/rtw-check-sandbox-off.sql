-- =====================================================================
-- Undo rtw-check-sandbox-on.sql: the automated right-to-work check goes
-- back to OFF with ADR-0041's defaults (gov.uk, no fallback, admin
-- confirms), the rtw-check job is disabled and unscheduled. The vault
-- secrets stay (harmless while the check is off; the nudge claims nothing).
-- Then remove RTW_PROVIDER_URL from the Back Office's Vercel project.
--
-- Checks already run keep their rows, reports and photos; their documents
-- stay in Needs review for the office to decide as usual.
-- =====================================================================
begin;

update settings
   set value = value || jsonb_build_object('enabled', false, 'primary', 'govuk', 'fallback', null,
                                           'admin_confirms', true)
 where key = 'rtw_check';

-- Anything still waiting would otherwise block the office's hand check.
update rtw_checks
   set status = 'failed', error = 'switched_off', lease_until = null, finished_at = now()
 where status in ('queued', 'running');

update job_schedules set enabled = false where job = 'rtw-check';
select install_job_schedules() as jobs_installed;

select rtw_check_config() as rtw_check,
       (select count(*) from cron.job where jobname = 'rtw-check') as rtw_cron_jobs;

commit;
