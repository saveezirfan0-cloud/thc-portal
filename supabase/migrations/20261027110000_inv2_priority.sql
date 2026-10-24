-- =====================================================================
-- ADR-0210 · INV2, the timesheet invoice the office composes and sends
--
-- INV2 is a document email (packages/notifications/src/documents.ts): the
-- row queue_timesheet_invoice_email() writes (20261027100000) is sent by
-- notify-drain as written, with every file in payload.attachments fetched
-- from the private `timesheets` bucket. Its send class is normal, like INV1.
-- INV2 has no switch: the office pressing Send is not turned off by INV1's
-- switch, which stops the automatic invoice only. Nothing else in the
-- database lists the document emails (the outbox purge tombstones every
-- family it does not name, which is right for an invoice number).
--
-- notification_priorities() restated from 20261026150000 with INV2.
-- priorityValuesSql() renders these rows.
-- =====================================================================
create or replace function public.notification_priorities()
returns table (code text, priority smallint)
language sql immutable set search_path = public, extensions as $$
  select v.code, v.priority::smallint from (values
    ('BG08', 1),
    ('CK1', 0),
    ('CL1', 1),
    ('CL2', 1),
    ('CL3', 1),
    ('CL4', 2),
    ('CL5', 1),
    ('CL6', 1),
    ('CP1', 1),
    ('CP2', 1),
    ('CP3', 1),
    ('CR1', 1),
    ('CR2', 0),
    ('CR3', 1),
    ('D1', 1),
    ('D2', 1),
    ('DR1', 1),
    ('E1', 1),
    ('E10', 0),
    ('E11', 1),
    ('E12', 1),
    ('E2', 1),
    ('E2b', 1),
    ('E3', 1),
    ('E4', 1),
    ('E5', 1),
    ('E5b', 1),
    ('E6', 1),
    ('E7', 1),
    ('E8', 1),
    ('E9', 1),
    ('INV1', 1),
    ('INV2', 1),
    ('IR1', 2),
    ('N1', 2),
    ('N10', 0),
    ('N10b', 0),
    ('N10c', 0),
    ('N10d', 0),
    ('N10e', 0),
    ('N11', 0),
    ('N11b', 0),
    ('N12', 0),
    ('N13', 0),
    ('N14', 1),
    ('N15', 1),
    ('N2', 2),
    ('N3', 2),
    ('N4', 1),
    ('N5', 0),
    ('N6', 0),
    ('N6b', 0),
    ('N7', 0),
    ('N8', 1),
    ('N9', 0),
    ('N9b', 0),
    ('NS1', 1),
    ('OC1', 2),
    ('OC2', 2),
    ('OC3', 2),
    ('OC4', 2),
    ('OF1', 0),
    ('OF2', 0),
    ('OF3', 0),
    ('OF4', 0),
    ('OF5', 0),
    ('OF6', 0),
    ('OM1', 0),
    ('OM2', 0),
    ('RC1', 1),
    ('RC2', 1),
    ('RC3', 1),
    ('RC4', 1),
    ('RC5', 1),
    ('SC1', 0),
    ('TK1', 1)
  ) as v(code, priority)
$$;

comment on function public.notification_priorities() is
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180), SC1 20261023100000 (ADR-0185), TK1 20261025110000 (ADR-0202), CK1 20261026150000 (ADR-0205), INV2 20261027110000 (ADR-0210).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
