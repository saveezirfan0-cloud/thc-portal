// Video 3 of the Back Office series: clients, roles and rates, venues,
// reports, feedback, settings, users and the activity log. Read-only.
// Email addresses of real people are masked by lib.mjs.
import {
  card,
  finish,
  hush,
  login,
  menu,
  point,
  press,
  say,
  scroll,
  sleep,
  soft,
  start,
  tab,
} from './lib.mjs';

const s = await start('office-3-directory-reports-admin');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Back Office Portal', '3 · Clients, reports and administration');
await login(s, 'office', 'gisela@thehospitalitycompany.example');

// ── Clients ──────────────────────────────────────────────────────────────
await say(s, 'Clients holds every customer, their contacts and their rates');
await press(s, menu(s, 'Clients'), { after: 1800 });
await settle();
await say(s, 'Open a client to see its card', 2200);
await soft('client card', async () => {
  await press(s, page.getByRole('link', { name: 'Leonardo Hotel St Pauls' }), { after: 1800 });
  await settle();
  await say(s, 'Contacts, and who the staff report to on the day', 3200);
  await scroll(s, 420, { pause: 500 });
  await say(s, 'The rate card: what the client is charged for each role, and the dress code', 4200);
  await scroll(s, 420, { pause: 500 });
  await say(s, 'Qualified staff: workers approved for this client. They are invited first', 4200);
  await scroll(s, 420, { pause: 2600 });
});

// ── Roles ────────────────────────────────────────────────────────────────
await say(s, 'Roles & rates sets what each role is paid');
await press(s, menu(s, 'Roles'), { after: 1800 });
await settle();
await say(
  s,
  'The base rate is what the worker sees. Holiday pay of +12.07% is added on top, and always shown separately',
  5200,
);
await say(s, 'Changes apply from now on. Exported payroll is never rewritten', 3600);

// ── Venues ───────────────────────────────────────────────────────────────
await say(s, 'Venues keeps each address and its geofence');
await press(s, menu(s, 'Venues'), { after: 1800 });
await settle();
await say(s, 'The geofence radius decides how close a worker must be to check in', 4200);
await soft('venue modal', async () => {
  await press(s, page.getByText(/Hurst Manor/).first(), { after: 1800 });
  await say(
    s,
    'A private residence has its own radius. Here it is widened to 250 m for the grounds',
    4200,
  );
  await page.keyboard.press('Escape');
  await sleep(800);
});

// ── Reports ──────────────────────────────────────────────────────────────
await say(s, 'Reports: Financial, Payroll and New Starter');
await press(s, menu(s, 'Reports'), { after: 1800 });
await settle();
await say(s, 'Financial: what clients are invoiced, what staff are paid, and the margin', 4200);
await say(
  s,
  'Payroll is base pay plus holiday, shown as two figures. They are never blended',
  4200,
);
await scroll(s, 380, { pause: 500 });
await say(s, 'Break the week down by day, by client, or by role');
await soft('by client', async () => {
  await press(s, tab(s, /^By client/), { after: 2800 });
  await press(s, tab(s, /^By role/), { after: 2800 });
});
await scroll(s, -380, { pause: 500 });
await say(
  s,
  'Payroll report: payable hours are the time between check-in and check-out that falls inside the shift',
);
await soft('payroll', async () => {
  await press(s, tab(s, /^Payroll report/), { after: 4200 });
});
await say(s, 'New Starter (HMRC): everyone who started in the period, ready for payroll');
await soft('starter', async () => {
  await press(s, tab(s, /^New Starter/), { after: 3800 });
});
await say(
  s,
  'Export CSV downloads the report. It is also emailed to finance every Monday at 09:00',
);
await soft('export', async () => {
  await point(
    s,
    page
      .getByRole('link', { name: /Export CSV/ })
      .or(page.getByRole('button', { name: /Export CSV/ })),
  );
  await sleep(3200);
});

// ── Feedback ─────────────────────────────────────────────────────────────
await say(s, 'Feedback gathers what clients say about workers, and the office’s own notes');
await press(s, menu(s, 'Feedback'), { after: 1800 });
await settle();
await say(
  s,
  'A client’s rating only counts towards the worker’s score once a manager presses Mark as read',
  5000,
);
await soft('mark', async () => {
  await point(s, page.getByRole('button', { name: 'Mark as read' }).first());
  await sleep(2000);
});
await say(s, 'Office feedback is internal and never shown to the client');
await soft('office fb', async () => {
  await press(s, tab(s, /^Office feedback/), { after: 3800 });
});

// ── Settings ─────────────────────────────────────────────────────────────
await say(s, 'Settings holds the rules the system runs on');
await press(s, menu(s, 'Settings'), { after: 1800 });
await settle();
await say(s, 'The auto-assign scoring weights can be tuned here', 3800);
await scroll(s, 520, { pause: 3200 });
await scroll(s, 520, { pause: 3200 });

// ── Users & access ───────────────────────────────────────────────────────
await say(s, 'Users & access: everyone who can sign in, by app');
await press(s, menu(s, 'Users & access'), { after: 1800 });
await settle();
await say(
  s,
  'Invite a Back Office user with a role: owner, manager, scheduler or read-only viewer',
  4600,
);
await say(s, 'Invite a client to the Client Portal. They receive a one-time set-up link', 4200);
await say(s, 'Switching a login off needs a reason, and is recorded', 3200);

// ── Activity log ─────────────────────────────────────────────────────────
await say(s, 'The Activity log records who did what, and when. It can be filtered and exported');
await press(s, menu(s, 'Activity log'), { after: 1800 });
await settle();
await sleep(3800);

// ── Inbox ────────────────────────────────────────────────────────────────
await say(s, 'Inbox lists the emails the platform has sent to the office and to payroll');
await press(s, menu(s, 'Inbox'), { after: 1800 });
await settle();
await sleep(3800);
await hush(s);

await card(s, 'That is the Back Office', 'Next: the Staff App', 2600);
await finish(s);
