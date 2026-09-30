// Onboarding, the office's side, part 2: the candidate's documents arrive in
// Compliance, the office verifies them, and the candidate's card moves on.
// Needs the candidate to have submitted documents (wizard step 4).
import {
  CANDIDATE,
  card,
  finish,
  hush,
  login,
  menu,
  point,
  press,
  say,
  sleep,
  soft,
  start,
} from './lib.mjs';

const s = await start('onboarding-3-office-verifies');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});
const name = `${CANDIDATE.first} ${CANDIDATE.last}`;

await card(s, 'Onboarding', 'The office’s side · checking documents', 3000);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(
  s,
  'When a candidate submits their documents, they appear in Compliance under Needs review',
);
await press(s, menu(s, 'Compliance'), { after: 1800 });
await settle();
await soft('row', async () => {
  await point(s, page.getByText(name).first());
  await sleep(1500);
});
await say(
  s,
  'Each row is one document: who it is from, what it is, and what the AI found on it',
  4600,
);
await say(s, 'The AI only suggests. A person always verifies', 3400);

const row = page.getByRole('row', { name: new RegExp(name) });
await say(
  s,
  'Check the file, then press Verify. Reject asks the candidate to upload it again, with your reason',
  600,
);
await soft('hover verify', async () => {
  await point(s, row.getByRole('button', { name: 'Reject' }).first());
  await sleep(2000);
});
await press(s, row.getByRole('button', { name: 'Verify' }).first(), { after: 1600 });

// Some documents ask for a confirmation in a dialog (an expiry date, say).
await soft(
  'dialog',
  async () => {
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 4000 });
    await say(s, 'Confirm the details shown, then Verify', 3200);
    const date = dialog.locator('input[type="date"]').first();
    if (await date.count()) {
      await point(s, date, 150);
      await date.fill('2031-01-12');
      await sleep(1200);
    }
    await press(s, dialog.getByRole('button', { name: /^(Verify|Confirm)/ }).last(), {
      after: 2400,
    });
  },
  { retries: 0 },
);
await settle();
await say(
  s,
  'Verified. Once every document is verified, the candidate’s remaining steps unlock by themselves',
  5000,
);

await say(s, 'On the Onboarding board the card has moved on to the Quiz stage');
await press(s, menu(s, 'Onboarding'), { after: 1800 });
await settle();
await soft('on quiz', async () => {
  await point(s, page.getByText(name).first());
  await sleep(3200);
});
await say(s, 'From here the candidate finishes the remaining steps on their phone', 3600);
await hush(s);

await card(s, 'Next: the rest of the candidate’s steps', 'Onboarding · on the phone', 2600);
await finish(s);
