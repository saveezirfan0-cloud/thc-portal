/* eslint-disable no-console -- command-line tool: printing is its output */
// Warms the speech cache ahead of a recording: finds every caption and title
// card in the scripts and asks the speech server (tts_server.py) to say it once.
// Usage, from this folder:  DEMO_TTS_URL=http://127.0.0.1:8765 node prefetch.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardSpeech } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DEMO_TTS_URL;
if (!url) throw new Error('Set DEMO_TTS_URL to the speech server, e.g. http://127.0.0.1:8765');

const STR = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"`;
const unquote = (lit) => new Function(`return ${lit}`)();
const texts = new Set();

for (const file of fs.readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'lib.mjs')) {
  const src = fs.readFileSync(path.join(here, file), 'utf8');
  for (const m of src.matchAll(new RegExp(STR, 'g'))) {
    const text = unquote(m[0]);
    // A caption: a sentence of several words, not a selector or a path.
    if (
      /^[A-Z][^{}<>=/\\@]*\s\S+\s\S+\s\S+/.test(text) &&
      text.length < 400 &&
      !/getBy|\.mjs/.test(text)
    )
      texts.add(text);
  }
  for (const m of src.matchAll(
    new RegExp(String.raw`card\(\s*s,\s*(${STR})\s*(?:,\s*(${STR}))?`, 'g'),
  )) {
    texts.add(cardSpeech(unquote(m[1]), m[2] ? unquote(m[2]) : ''));
  }
}

const list = [...texts];
console.log(`${list.length} lines to cache`);
for (let i = 0; i < list.length; i += 10) {
  const res = await fetch(`${url}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: list.slice(i, i + 10) }),
  });
  if (!res.ok) throw new Error(`batch failed: ${res.status}`);
  console.log(`${Math.min(i + 10, list.length)}/${list.length}`);
}
