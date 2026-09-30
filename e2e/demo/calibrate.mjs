/* eslint-disable no-console -- command-line tool: printing is its output */
// Measures how far the voice-over is from the picture on this machine. Flashes
// the screen white at a known instant with a spoken word at the same instant,
// then reads both back out of the finished file. Prints the DEMO_AUDIO_OFFSET
// (seconds) that lines them up.
import { spawnSync } from 'node:child_process';
import { finish, sleep, start } from './lib.mjs';

const FFMPEG = process.env.DEMO_FFMPEG || 'ffmpeg';
const s = await start('calibrate');
await s.page.setContent('<body style="margin:0;background:#000"></body>');
await sleep(2500);
const res = await fetch(`${process.env.DEMO_TTS_URL}/say`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Now.' }),
});
const speech = await res.json();
await s.page.evaluate(() => {
  document.body.style.background = '#fff';
});
s.cues.push({ at: (Date.now() - s.t0) / 1000, file: speech.file });
await sleep(2500);
const file = await finish(s);

const run = (args) => {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`;
};
// Picture: the first frame that is bright.
const video = run([
  '-i',
  file,
  '-vf',
  'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
  '-an',
  '-f',
  'null',
  '-',
]);
const frames = [...video.matchAll(/pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g)].map((m) => [
  Number(m[1]),
  Number(m[2]),
]);
const flash = frames.find(([, y]) => y > 128)?.[0];
// Sound: where the speech begins.
const audio = run(['-i', file, '-vn', '-af', 'silencedetect=noise=-45dB:d=0.3', '-f', 'null', '-']);
const onset = Number([...audio.matchAll(/silence_end: ([\d.]+)/g)][0]?.[1]);
console.log(
  JSON.stringify({ cueAt: s.cues[0].at, flashInVideo: flash, speechOnsetInAudio: onset }),
);
if (flash !== undefined && Number.isFinite(onset))
  console.log(`DEMO_AUDIO_OFFSET=${(flash - onset).toFixed(2)}`);
