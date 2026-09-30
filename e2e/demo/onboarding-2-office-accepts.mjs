// Onboarding, the office's side, part 1: the board, the interview result,
// and Accept. Needs the candidate created by onboarding-1-apply.mjs.
//
// Willo is an outside system, so its "interview completed" webhook is played
// here by calling the same database function the real webhook calls.
import {
  CANDIDATE,
  card,
  finish,
  go,
  hush,
  login,
  menu,
  point,
  press,
  rest,
  rpc,
  say,
  scroll,
  sleep,
  soft,
  start,
} from './lib.mjs';

const [cand] = await rest(
  `staff?select=id,willo_candidate_id,status&email=eq.${encodeURIComponent(CANDIDATE.email)}&removed_at=is.null`,
);
if (!cand) throw new Error('Run onboarding-1-apply.mjs first: the candidate does not exist.');

const s = await start('onboarding-2-office-accepts');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});
const name = `${CANDIDATE.first} ${CANDIDATE.last}`;

await card(s, 'Onboarding', 'The office’s side · from application to Accept', 3000);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Onboarding is one board for every candidate, from application to contract');
await press(s, menu(s, 'Onboarding'), { after: 1800 });
await settle();
await say(
  s,
  'Each column is a stage. A new application lands in Interview requested by itself',
  4200,
);
await soft('jordan card', async () => {
  await point(s, page.getByText(name).first());
  await sleep(1500);
});
await say(
  s,
  'The candidate was sent a link to a short video interview. There is nothing for the office to do yet',
  4800,
);

if (cand.status === 'interview_requested') {
  await say(
    s,
    'When they finish the interview, Willo tells us, and the card moves on its own',
    3200,
  );
  await rpc('willo_record_event', {
    p_willo_candidate_id: cand.willo_candidate_id,
    p_event: 'new_response',
    p_at: new Date().toISOString(),
    p_details: { answersDone: 5, answersTotal: 5 },
  });
  await go(s, 'office', '/onboarding', { wait: 1800 });
}
await say(s, 'There it is, under Interview completed', 3200);
await soft('moved', async () => {
  await point(s, page.getByText(name).first());
  await sleep(1200);
});

await say(s, 'Open the candidate to review them');
await press(s, page.getByText(name).first(), { after: 1800 });
await settle();
await say(
  s,
  'The profile follows the stages. The interview result comes from Willo, where the video is watched',
  4800,
);
await scroll(s, 260, { pause: 600 });
await say(
  s,
  'Rejected in Willo rejects automatically. Accepted in Willo moves them to Documents by itself',
  4800,
);

await say(s, 'Or accept here. First choose the role or roles the candidate is qualified for');
await soft('role', async () => {
  const role = page.locator('label.check').filter({ hasText: 'Waiting Staff' }).first();
  // Tick it only if it is not already ticked (a returning candidate keeps theirs).
  const ticked = await role.evaluate((el) => el.classList.contains('sel'));
  if (ticked) {
    await point(s, role, 200);
    await sleep(900);
  } else {
    await press(s, role, { after: 900 });
  }
});
await say(
  s,
  'This is what makes them eligible for shifts of that role. It can be changed later on their profile',
  4600,
);
await soft('note', async () => {
  const note = page.getByLabel(/Internal note/);
  await point(s, note, 150);
  await note.click();
  await note.pressSequentially('Confident, clear English, previous silver-service experience', {
    delay: 40,
  });
  await sleep(900);
});

await say(
  s,
  'Accept. The system creates their login and emails them a personal activation link',
  500,
);
await press(s, page.getByRole('button', { name: /Accept — move to Documents/ }), { after: 3200 });
await settle();
await say(s, 'They move to Documents. The link takes them straight into the Staff App', 4600);
await scroll(s, -600, { pause: 600 });

await say(s, 'Back on the board, the card is now under Documents');
await press(s, menu(s, 'Onboarding'), { after: 1800 });
await settle();
await soft('in documents', async () => {
  await point(s, page.getByText(name).first());
  await sleep(3000);
});
await say(
  s,
  'From here the candidate works through the steps on their phone. Next: what they see',
  4200,
);
await hush(s);

await card(s, 'Next: the candidate activates their account', 'Onboarding · on the phone', 2600);
await finish(s);
