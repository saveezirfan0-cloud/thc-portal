// Video 2 of the Back Office series: the live check-in monitor and violation
// log, the staff directory and a worker's profile, compliance, and the
// onboarding board. Read-only: nothing is saved.
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

const s = await start('office-2-checkin-staff-compliance');
const { page } = s;

await card(s, 'Back Office Portal', '2 · Check-in, staff and compliance');
await login(s, 'office', 'gisela@thehospitalitycompany.example');

// ── Check In / Out ───────────────────────────────────────────────────────
await say(s, 'Check In / Out is the live monitor for every shift happening today');
await press(s, menu(s, 'Check In / Out'), { after: 1800 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(
  s,
  'It refreshes itself every 30 seconds. A red banner means a shift has someone missing',
  3600,
);
await soft('banner', async () => {
  await point(s, page.getByText(/not checked in/i).first());
  await sleep(2200);
});
await say(s, 'Each row is one worker: their window, when they checked in, breaks, and status');
await soft('on shift', async () => {
  await point(s, page.getByText('On shift', { exact: true }).first());
  await sleep(2600);
});
await say(
  s,
  'Check-in opens at the start. 30 minutes after the start they are marked as a no-show automatically',
);
await soft('alert', async () => {
  await point(s, page.getByText(/30 min alert/i).first());
  await sleep(3800);
});
await say(s, 'Evening sections show when check-in is due');
await soft('due', async () => {
  await point(s, page.getByText(/^Due /).first());
  await sleep(2600);
});

await say(s, 'Needs attention filters to only the people who need a call');
await soft('attention', async () => {
  await press(s, tab(s, /Needs attention/), { after: 2200 });
  await press(s, tab(s, /^All$/), { after: 1200 });
});

await say(s, 'Below, the violation log: no-show, late, left early, and no check-out');
await scroll(s, 520, { pause: 3200 });
await say(
  s,
  'A violation is never silently fixed. A manager opens Details and records what happened',
);
await soft('details', async () => {
  await point(s, page.getByRole('button', { name: 'Details' }).first());
  await sleep(3000);
});
await say(s, 'Tick Show resolved to see past violations and the notes that closed them');
await soft('resolved', async () => {
  await press(s, page.getByText('Show resolved').first(), { after: 3200 });
});

// ── Staff directory ──────────────────────────────────────────────────────
await say(s, 'Staff is the directory of everyone on the books');
await press(s, menu(s, 'Staff'), { after: 1800 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(s, 'Filter by status: Compliant, Blocked, Inactive or Removed', 2600);
await soft('blocked', async () => {
  await press(s, tab(s, /^Blocked/), { after: 1600 });
  await say(
    s,
    'A blocked worker shows why, and whether a client has asked not to have them back',
    4200,
  );
  await press(s, tab(s, /^All/), { after: 1200 });
});
await say(s, 'Student visa view lists the workers whose weekly hours are capped');
await soft('student', async () => {
  await press(s, tab(s, /Student visa/), { after: 2200 });
  await say(
    s,
    'The cap is calculated from term dates and visa, never typed in: 20 hours in term, 48 in holidays',
    4800,
  );
  await press(s, tab(s, /^Directory/), { after: 1200 });
});
await say(
  s,
  'Removed accounts read “Deleted account #id”. History is kept, personal data is not',
  3600,
);

await say(s, 'Open a worker for their full profile');
await press(s, page.getByRole('link', { name: 'Amara Kalu' }), { after: 1800 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(s, 'Overview: contact details, right to work, weekly hours cap, and pay rate', 3600);
await scroll(s, 420, { pause: 2600 });
await scroll(s, -420, { pause: 500 });
for (const [name, line] of [
  ['Documents', 'Documents: every file uploaded, its expiry, and whether it has been verified'],
  [
    'Client qualification',
    'Client qualification: which clients this worker is approved for, per role',
  ],
  ['Shifts', 'Shifts: their booking history, including cancellations and who cancelled'],
  ['Feedback', 'Feedback from clients and notes from the office'],
  ['Availability', 'Availability: the days the worker has marked as unavailable'],
]) {
  await soft(name, async () => {
    await press(s, s.page.getByRole('tab', { name: new RegExp(`^${name}`) }), { after: 600 });
    await say(s, line, 3200);
  });
}

// ── Compliance ───────────────────────────────────────────────────────────
await say(s, 'Compliance is where every uploaded document is checked');
await press(s, menu(s, 'Compliance'), { after: 1800 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(s, 'Needs review: documents and declarations waiting for a person', 3200);
await say(s, 'The AI reads each document and shows what it found, with its confidence');
await soft('ai', async () => {
  await point(s, page.getByText(/AI \d+%/).first());
  await sleep(3000);
});
await say(s, 'Verify accepts it. Reject asks the worker to upload again, with your reason');
await soft('verify', async () => {
  await point(s, page.getByRole('button', { name: 'Verify' }).first());
  await sleep(1800);
  await point(s, page.getByRole('button', { name: 'Reject' }).first());
  await sleep(2400);
});
await say(s, 'Radar: documents that have expired or are about to, with automatic reminders');
await soft('radar', async () => {
  await press(s, tab(s, /^Radar/), { after: 3800 });
});
await say(s, 'gov.uk checks: the automatic right-to-work check and what it found');
await soft('checks', async () => {
  await press(s, tab(s, /gov\.uk checks/), { after: 3800 });
});
await say(s, 'An expired right-to-work blocks the worker from being booked, automatically');
await sleep(2800);

// ── Onboarding board ─────────────────────────────────────────────────────
await say(s, 'Onboarding shows every candidate on one board, from interview to contract');
await press(s, menu(s, 'Onboarding'), { after: 1800 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(
  s,
  'Each column is a stage. Cards move on their own as the candidate completes each step',
  4200,
);
await scroll(s, 0, { pause: 400 });
await hush(s);

await card(s, 'Next: clients, reports and settings', 'Back Office Portal · part 3', 2600);
await finish(s);
