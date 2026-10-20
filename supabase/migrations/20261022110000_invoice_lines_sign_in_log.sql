-- =====================================================================
-- 20261022110000 · The invoice's supporting sign-in / sign-out log
--                   ADR-0176 (amended 20.10.2026)
--
-- THC, 20.10.2026: "At 10:00 the day after the event, the invoice is sent
-- attached by a log of the staff that signed in and signed out and showing
-- any breaks taken. This supports the invoice so clients can cross check
-- the sign in and sign out log against the invoice." The allocation-style
-- timesheet (the D1 sheet the client already has from 16:00 the day
-- before, with signature boxes) is not that log, so the invoice email now
-- carries a log drawn from the invoice's own lines.
--
-- For the log to agree with the invoice line for line, the lines keep, as
-- issued, what the worker actually did:
--   check_in_at / check_out_at   the Staff App's sign-in and sign-out
--   late, left_early             RULE-14's flags on that shift
--   finish_by_office             the finish time was entered by the office
--                                (a No check-out resolved, §9.5)
--   floor_applied                the 4-hour minimum (RULE-01/02)
--
-- invoice_claim() and invoice_document_data() are restated by replacing
-- text in their live definitions, so nothing else in them changes.
-- Forward-only. No invoice exists in production before 27.10.2026, so
-- there is nothing to backfill.
-- =====================================================================

alter table public.invoice_lines
  add column if not exists check_in_at      timestamptz,
  add column if not exists check_out_at     timestamptz,
  add column if not exists late             boolean not null default false,
  add column if not exists left_early       boolean not null default false,
  add column if not exists finish_by_office boolean not null default false,
  add column if not exists floor_applied    boolean not null default false;

comment on column public.invoice_lines.check_in_at is
  'ADR-0176: the worker''s sign-in as issued (Staff App check-in), for the sign-in / sign-out log attached to the invoice.';
comment on column public.invoice_lines.check_out_at is
  'ADR-0176: the worker''s sign-out as issued (Staff App check-out, or the finish time the office entered — finish_by_office).';

do $$
declare
  v_def text := pg_get_functiondef('public.invoice_claim(text, timestamptz)'::regprocedure);
  v_new text;
  a1 text := 'rate, amount, kind)';
  b1 text := 'rate, amount, kind, check_in_at, check_out_at, late, left_early,
                             finish_by_office, floor_applied)';
  a2 text := 'coalesce(l.invoicing, 0), l.kind
    from report_payroll_lines_v l';
  b2 text := 'coalesce(l.invoicing, 0), l.kind, l.check_in_at, l.check_out_at,
         coalesce(l.late_check_in, false), coalesce(l.early_check_out, false),
         exists (select 1 from violations v
                  where v.booking_id = l.booking_id and v.type = ''no_checkout'' and v.resolved),
         coalesce(l.floor_applied, false)
    from report_payroll_lines_v l';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception '20261022110000: invoice_claim — expected one match of each snapshot fragment';
  end if;
  v_new := replace(replace(v_def, a1, b1), a2, b2);
  execute v_new;
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public.invoice_document_data(uuid)'::regprocedure);
  a text := '''amount'', l.amount, ''kind'', l.kind)';
  b text := '''amount'', l.amount, ''kind'', l.kind,
                        ''checkInAt'', l.check_in_at, ''checkOutAt'', l.check_out_at,
                        ''late'', l.late, ''leftEarly'', l.left_early,
                        ''finishByOffice'', l.finish_by_office, ''floorApplied'', l.floor_applied,
                        ''eventId'', l.event_id)';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception '20261022110000: invoice_document_data — expected one match of the line fields';
  end if;
  execute replace(v_def, a, b);
end $$;

comment on function public.invoice_claim(text, timestamptz) is
  'ADR-0176: issues the invoice for a due group under an advisory lock — the next number from invoice_counter (gapless), the bill-to and seller snapshotted, the events linked (each once), the settled billable lines copied with the actual sign-in / sign-out, late, left-early, office-entered finish and 4-hour-minimum flags, net/VAT/total. Null when the group is no longer due. Service role.';
