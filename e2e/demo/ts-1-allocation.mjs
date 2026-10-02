// Timesheets, part 1: the Allocation Timesheet and what is on it. Read-only.
// Run ts-prep.mjs first (it downloads the PDFs this part shows).
import path from 'node:path';
import { card, finish, go, hush, login, point, say, sleep, soft, start } from './lib.mjs';
import { COL, GALA2_FOOTER, GALA2_TITLE, GALA_BAND_WS, HEADER, PO, TITLE_ROW, box, showDoc } from './doc-lib.mjs';

const DOCS = process.env.DEMO_DOCS || './out/docs';
const GALA = '60000000-0000-4000-8000-000000000001';
const s = await start('ts-1-allocation');
const { page } = s;

await card(s, 'Timesheets', 'The Allocation Timesheet', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Every event has one timesheet document, and its buttons are on the event page');
await go(s, 'office', `/events/${GALA}`, { wait: 1800 });
await soft('buttons', async () => {
  await point(s, page.getByRole('button', { name: 'Send Allocation Timesheet' }));
  await sleep(900);
  await point(s, page.getByRole('link', { name: 'Download Allocation Timesheet' }));
  await sleep(1200);
});
await say(s, 'Send emails it. Download gives you the P D F, to print or to drop into WhatsApp. This is exactly what the client gets', 7600);

await showDoc(s, path.join(DOCS, 'allocation-gala-p1.png'));
await say(s, 'It is THC’s own form, and it is one document for the whole event, with every role on it. Not one sheet per role', 7000);
await box(s, HEADER);
await say(s, 'At the top, our name and the words Staff Allocation, with the date of the event', 5200);
await box(s, TITLE_ROW);
await say(s, 'Then the client and the event name, and the client’s purchase order number, so their finance team can reconcile it', 7000);
await box(s, PO, 800);
await box(s, COL.photo);
await say(s, 'Each worker has a photo, so the person can be matched to the sheet on site', 5000);
await box(s, COL.name);
await say(s, 'Their name, their employee I D, the same one used in payroll, and their role', 5600);
await box(s, COL.start);
await say(s, 'Start time is the scheduled start, with the planned finish in brackets', 5000);
await box(s, COL.finish);
await say(s, 'Finish time and hours worked stay empty on this version. It goes out before the event', 5600);
await box(s, COL.hours, 1200);
await box(s, COL.signature);
await say(s, 'The signature is the client’s, made by hand. So is any comment, such as breaks', 5600);
await box(s, COL.comments, 1200);
await box(s, COL.alcohol);
await say(s, 'And a column confirming the alcohol policy was understood and agreed', 4800);
await box(s, GALA_BAND_WS);
await say(s, 'People are grouped by role, in running order, and by surname within each role, so anyone is easy to find on a long sheet', 8200);
await say(s, 'A page holds at most twelve people. This role carries on to page two', 5200);

await box(s, null, 300);
await showDoc(s, path.join(DOCS, 'allocation-gala-p2.png'));
await box(s, GALA2_TITLE);
await say(s, 'The next page repeats the header and the column titles, and says continued', 5400);
await box(s, GALA2_FOOTER);
await say(s, 'The totals block, with total hours, manager’s name, signature and date, appears once, on the last page', 7000);
await hush(s);
await card(s, 'Next: sending it', 'Timesheets · part 2', 2400);
await finish(s);
