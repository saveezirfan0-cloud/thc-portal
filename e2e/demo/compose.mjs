/* eslint-disable no-console -- command-line tool: printing is its output */
// Builds the two combined training videos from the recorded segments:
//
//   Staff training       onboarding (apply, activate, steps 1-11) + the Staff App
//   Office portal        dashboard/scheduling, check-in/staff/compliance, onboarding, admin
//
// Each segment was recorded with its own title and closing card. Those are cut
// off here and replaced with consistent, narrated "Part N of M" dividers that name
// the steps the part covers, plus an opening contents card and a closing card.
// The result carries MP4 chapters, so a player shows the parts.
//
//   DEMO_OUT, DEMO_FFMPEG, DEMO_TTS_URL   as for the recorder (the speech server is needed)
//   node compose.mjs [staff|office]       (default: both)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FRAME, OUT, card, cardSpeech, finish, sleep, start, warmSpeech } from './lib.mjs';

const FFMPEG = process.env.DEMO_FFMPEG || 'ffmpeg';
const DIR = {
  cards: path.join(OUT, 'cards'),
  trimmed: path.join(OUT, 'trimmed'),
  out: path.join(OUT, 'combined'),
};
for (const d of Object.values(DIR)) fs.mkdirSync(d, { recursive: true });

const GROUPS = {
  staff: {
    file: 'THC-Staff-Training-Onboarding-and-the-Staff-App',
    kind: 'mobile',
    label: 'Staff training',
    title: 'Staff training',
    outro: ['That is the end of the staff training', 'Onboarding, then the Staff App'],
    parts: [
      {
        title: 'Applying to work with us',
        lines: 'The public application form',
        spoken: '',
        segs: ['onboarding-1-apply'],
      },
      {
        title: 'Activating your account',
        lines:
          'Your personal link and password<br>Steps 1 to 4: right to work, home address,<br>profile photo, documents',
        spoken: 'Steps 1 to 4.',
        segs: ['onboarding-4-candidate-activates'],
      },
      {
        title: 'Finishing your onboarding',
        lines:
          'After the office has checked your documents<br>Steps 5 to 11: induction, quiz, tax checklist,<br>references, bank details, contract, how it works',
        spoken: 'Steps 5 to 11.',
        segs: ['onboarding-5-candidate-finishes'],
      },
      {
        title: 'The Staff App: a working day',
        lines:
          'Your shifts, GPS check-in and check-out<br>Open shifts, invites, radar and your profile',
        spoken: '',
        segs: ['staff-1-working-day'],
      },
    ],
  },
  scheduling: {
    file: 'THC-How-Scheduling-Works',
    kind: 'desktop',
    label: 'Scheduling',
    title: 'How scheduling works',
    outro: ['That is the whole scheduling cycle', 'Build, book, change, confirm, send'],
    parts: [
      {
        title: 'Building an event',
        lines: 'The Shift Builder: client and venue, date,<br>roles, headcount and buffer, then save',
        spoken: '',
        segs: [{ name: 'sched-1-build-event', skipLogin: true }],
      },
      {
        title: 'How staff get booked on',
        lines:
          'Auto-assign, inviting by hand from the pool,<br>workers applying on Radar, and shift hand-overs',
        spoken: '',
        segs: [{ name: 'sched-2-booking-options', skipLogin: true }],
      },
      {
        title: 'Changing the time',
        lines: 'Awaiting re-confirmation on the board<br>and Confirm new time on the worker’s phone',
        spoken: '',
        segs: [
          { name: 'sched-3-time-change', skipLogin: true },
          { name: 'sched-3b-worker-time-change', skipLogin: true, phone: true },
        ],
      },
      {
        title: 'Changing the number of staff',
        lines: 'Needing more people, or fewer,<br>even the night before',
        spoken: '',
        segs: [{ name: 'sched-4-headcount', skipLogin: true }],
      },
      {
        title: 'How timesheets are sent',
        lines: 'The Allocation Timesheet: automatic sends,<br>Send and Download on the event page',
        spoken: '',
        segs: [{ name: 'sched-5-timesheets', skipLogin: true }],
      },
      {
        title: 'Confirming shifts',
        lines:
          'Accepting, I’m ready by twelve noon,<br>and confirming on the day. How the office knows',
        spoken: '',
        segs: [
          { name: 'sched-6a-confirmation', skipLogin: true },
          { name: 'sched-6b-worker-ready', skipLogin: true, phone: true },
          { name: 'sched-6c-office-sees-ready', skipLogin: true },
        ],
      },
      {
        title: 'How auto-assign works',
        lines: 'Hard gates, two waves, the five-part score,<br>hourly rounds and same-day escalation',
        spoken: '',
        segs: [{ name: 'sched-7-auto-assign', skipLogin: true }],
      },
      {
        title: 'When a role shrinks',
        lines: 'What happens to staff who are already confirmed<br>when fewer people are needed',
        spoken: '',
        segs: [{ name: 'sched-8-overbooked', skipLogin: true }],
      },
    ],
  },
  office: {
    file: 'THC-Office-Portal-Training',
    kind: 'desktop',
    label: 'Office portal',
    title: 'Back Office Portal training',
    outro: ['That is the end of the office portal training', 'Dashboard to administration'],
    parts: [
      {
        title: 'The dashboard and scheduling',
        lines:
          'Signing in, the dashboard, events list and calendar,<br>the event board and the Shift Builder',
        spoken: '',
        segs: ['office-1-dashboard-and-scheduling'],
      },
      {
        title: 'Check in, staff and compliance',
        lines:
          'The live check-in monitor and violation log<br>The staff directory and profiles, then compliance',
        spoken: '',
        segs: [{ name: 'office-2-checkin-staff-compliance', skipLogin: true }],
      },
      {
        title: 'Onboarding new staff',
        lines: 'The candidate board, accepting a candidate,<br>and checking their documents',
        spoken: '',
        segs: [
          { name: 'onboarding-2-office-accepts', skipLogin: true },
          { name: 'onboarding-3-office-verifies', skipLogin: true },
        ],
      },
      {
        title: 'Clients, reports and administration',
        lines:
          'Clients, roles and rates, venues, reports, feedback,<br>settings, users and the activity log',
        spoken: '',
        segs: [{ name: 'office-3-directory-reports-admin', skipLogin: true }],
      },
    ],
  },
};

const run = (args) => {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  return { out: `${r.stdout}${r.stderr}`, code: r.status };
};
const must = (args) => {
  const r = run(['-y', '-loglevel', 'error', ...args]);
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${r.out.slice(0, 400)}`);
};
const seconds = (file) => {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(run(['-i', file]).out);
  if (!m) throw new Error(`cannot read the length of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/** One narrated card, recorded the same way as a segment so the encoding matches. */
async function renderCard(kind, name, title, sub, hold, opts) {
  const cached = path.join(DIR.cards, `${name}.mp4`);
  if (fs.existsSync(cached) && !process.env.FORCE) return cached;
  // Make the speech first: the recorder starts on a blank white page, and a line
  // generated while it runs would leave seconds of white at the head of the clip.
  await warmSpeech(opts?.speech ?? cardSpeech(title, sub));
  const raw = path.join(OUT, `${name}.mp4`);
  const s = await start(name, { kind });
  await card(s, title, sub, hold, opts);
  await sleep(300);
  await finish(s);
  // What is left is a few blank frames before the card paints; cut them.
  must([
    '-i',
    raw,
    '-ss',
    '0.45',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-c:a',
    'aac',
    '-b:a',
    '112k',
    '-ar',
    '44100',
    '-ac',
    '1',
    cached,
  ]);
  fs.rmSync(raw);
  return cached;
}

/** A phone recording shown at full height, centred on a dark desktop-sized frame. */
async function onDesktop(file, name) {
  const dst = path.join(DIR.trimmed, `${name}.desk.mp4`);
  must([
    '-i',
    file,
    '-vf',
    `scale=-2:${FRAME.desktop.height - 20},pad=${FRAME.desktop.width}:${FRAME.desktop.height}:(ow-iw)/2:10:color=0x0f172a,setsar=1`,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-c:a',
    'copy',
    dst,
  ]);
  return dst;
}

/** The card background with no text, as a PNG the size of the recording. */
async function cleanBackground(kind) {
  const png = path.join(DIR.cards, `clean-${kind}.png`);
  if (fs.existsSync(png) && !process.env.FORCE) return png;
  const s = await start(`clean-${kind}`, { kind });
  s.narrate = false;
  await card(s, '', '', 0, { eyebrow: '' });
  await s.page.screenshot({ path: png });
  await s.ctx.close();
  await s.browser.close();
  return png;
}

/**
 * Cuts a segment's own opening and closing card off.
 * Start: the first caption can already be on the opening card, so cut in the gap
 * after the card's narration, or at the first light frame if that comes sooner.
 * End: just after the last light frame (the closing card is dark).
 */
async function trim(seg, kind, skipLogin = false) {
  const src = path.join(OUT, `${seg}.mp4`);
  const dst = path.join(DIR.trimmed, `${seg}.mp4`);
  const length = seconds(src);
  const luma = run([
    '-i',
    src,
    '-vf',
    'fps=4,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-an',
    '-f',
    'null',
    '-',
  ]).out;
  const frames = [...luma.matchAll(/pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  // Skip the first second: the recorder's blank white first frame is not a page.
  const light = frames.filter(([t, y]) => t > 1 && y > 110).map(([t]) => t);
  if (!light.length) throw new Error(`${seg}: no light frames found`);
  const gaps = [
    ...run([
      '-i',
      src,
      '-vn',
      '-af',
      'silencedetect=noise=-38dB:d=0.6',
      '-f',
      'null',
      '-',
    ]).out.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g),
  ].map((m) => [Number(m[1]), Number(m[2])]);
  const firstGap = gaps.find(([a]) => a > 0.8);
  const gapMid = firstGap ? (firstGap[0] + firstGap[1]) / 2 : Infinity;
  // skipLogin: the long silence after the card is the sign-in being typed; start
  // just before the first caption, on the page the sign-in leads to.
  const from = Math.max(
    0,
    skipLogin && firstGap && firstGap[1] - firstGap[0] > 6
      ? firstGap[1] - 0.8
      : Math.min(light[0] - 0.15, gapMid),
  );
  const to = Math.min(length, light[light.length - 1] + 0.4);
  // While the first caption is still over the old title card, paint the old title
  // block out with a text-free copy of the same background (caption and voice stay).
  const cardEnds = light[0] - 0.05;
  const cover = cardEnds - from > 0.4;
  console.log(
    `trim ${seg}: ${length.toFixed(1)}s -> ${from.toFixed(1)}..${to.toFixed(1)} (first light ${light[0].toFixed(1)}, gap ${firstGap ? firstGap.map((x) => x.toFixed(1)).join('-') : 'none'}${cover ? ', covering the old title' : ''})`,
  );
  const { width: w, height: h } = FRAME[kind === 'mobile' ? 'mobile' : 'desktop'];
  const y0 = Math.round(h * 0.22);
  const filter = cover
    ? [
        '-loop',
        '1',
        '-framerate',
        '25',
        '-i',
        await cleanBackground(kind),
        '-filter_complex',
        `[1:v]scale=${w}:${h},crop=${w}:${Math.round(h * 0.5)}:0:${y0}[c];[0:v][c]overlay=0:${y0}:enable='between(t,${from.toFixed(2)},${cardEnds.toFixed(2)})':shortest=1[v]`,
        '-map',
        '[v]',
        '-map',
        '0:a',
      ]
    : [];
  must([
    '-i',
    src,
    ...filter,
    '-ss',
    String(from),
    '-to',
    String(to),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-c:a',
    'aac',
    '-b:a',
    '112k',
    '-ar',
    '44100',
    '-ac',
    '1',
    dst,
  ]);
  return dst;
}

async function build(key) {
  const g = GROUPS[key];
  const n = g.parts.length;
  const clips = []; // { file, chapter? }

  const intro = await renderCard(
    g.kind,
    `card-${key}-intro`,
    g.title,
    g.parts.map((p, i) => `${i + 1} · ${p.title}`).join('<br>'),
    3500,
    {
      speech: `${g.title}. In this video: ${g.parts.map((p) => p.title).join('; ')}.`,
    },
  );
  clips.push({ file: intro, chapter: 'Contents' });

  for (const [i, part] of g.parts.entries()) {
    const divider = await renderCard(
      g.kind,
      `card-${key}-part-${i + 1}`,
      part.title,
      part.lines,
      3200,
      {
        eyebrow: `Part ${i + 1} of ${n} · ${g.label}`,
        progress: [i + 1, n],
        speech: `Part ${i + 1} of ${n}. ${part.title}.${part.spoken ? ` ${part.spoken}` : ''}`,
      },
    );
    clips.push({ file: divider, chapter: `Part ${i + 1} of ${n}: ${part.title}` });
    for (const seg of part.segs) {
      const { name, skipLogin, phone } = typeof seg === 'string' ? { name: seg } : seg;
      const trimmed = await trim(name, phone ? 'mobile' : g.kind, skipLogin);
      clips.push({ file: phone && g.kind === 'desktop' ? await onDesktop(trimmed, name) : trimmed });
    }
  }

  const outro = await renderCard(g.kind, `card-${key}-outro`, g.outro[0], g.outro[1], 3000, {
    eyebrow: g.label,
    speech: `${g.outro[0]}.`,
  });
  clips.push({ file: outro, chapter: 'End' });

  // Join, re-encoding so clips of slightly different origin cannot disagree.
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const prep = clips.map(
    (_, i) =>
      `[${i}:v]fps=25,setsar=1,format=yuv420p[v${i}];[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[a${i}]`,
  );
  const join = `${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[v][a]`;
  const joined = path.join(DIR.out, `${g.file}.joined.mp4`);
  must([
    ...inputs,
    '-filter_complex',
    [...prep, join].join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '24',
    '-c:a',
    'aac',
    '-b:a',
    '112k',
    joined,
  ]);

  // Chapters at each card.
  let at = 0;
  const marks = [];
  for (const c of clips) {
    if (c.chapter) marks.push({ start: at, title: c.chapter });
    at += seconds(c.file);
  }
  const total = seconds(joined);
  const meta = [';FFMETADATA1', `title=${g.title}`]
    .concat(
      marks.flatMap((m, i) => [
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${Math.round(m.start * 1000)}`,
        `END=${Math.round((i + 1 < marks.length ? marks[i + 1].start : total) * 1000)}`,
        `title=${m.title}`,
      ]),
    )
    .join('\n');
  const metaFile = path.join(DIR.out, `${g.file}.chapters.txt`);
  fs.writeFileSync(metaFile, meta);
  const dst = path.join(DIR.out, `${g.file}.mp4`);
  must([
    '-i',
    joined,
    '-i',
    metaFile,
    '-map_metadata',
    '1',
    '-map_chapters',
    '1',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    dst,
  ]);
  fs.rmSync(joined);
  fs.rmSync(metaFile);
  console.log(
    `wrote ${dst} (${(fs.statSync(dst).size / 1048576).toFixed(1)} MB, ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}, ${marks.length} chapters)`,
  );
  for (const m of marks)
    console.log(
      `  ${String(Math.floor(m.start / 60)).padStart(2, '0')}:${String(Math.round(m.start % 60)).padStart(2, '0')}  ${m.title}`,
    );
}

const want = process.argv[2];
for (const key of Object.keys(GROUPS)) if (!want || want === key) await build(key);
