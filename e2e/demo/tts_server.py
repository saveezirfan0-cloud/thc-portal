"""Local text-to-speech for the demo videos (Kokoro, offline once the model is on disk).

Run it once and leave it running while the recorder scripts work:

    pip install kokoro-onnx soundfile
    KOKORO_MODEL=kokoro-v1.0.onnx KOKORO_VOICES=voices-v1.0.bin TTS_CACHE=./tts-cache \
        python3 tts_server.py

Both model files are release assets at
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Every line is synthesised once and cached by a hash of voice, speed and text, so
re-recording a video costs no synthesis time and always sounds the same.

    POST /say    {"text": "..."}        -> {"file": "<wav path>", "seconds": 3.2}
    POST /batch  {"texts": ["...", ...]} -> {"done": N}     (warm the cache ahead of a run)
    GET  /health
"""

import hashlib
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
from kokoro_onnx import Kokoro

MODEL = os.environ["KOKORO_MODEL"]
VOICES = os.environ["KOKORO_VOICES"]
CACHE = os.path.abspath(os.environ.get("TTS_CACHE", "./tts-cache"))
VOICE = os.environ.get("TTS_VOICE", "bf_emma")  # British English, female
SPEED = float(os.environ.get("TTS_SPEED", "0.95"))
PORT = int(os.environ.get("TTS_PORT", "8765"))

os.makedirs(CACHE, exist_ok=True)
kokoro = Kokoro(MODEL, VOICES)
lock = threading.Lock()

# Written for the eye, read aloud: spell out what the voice would get wrong.
SPOKEN = [
    (r"\(\+(\d+)\)", r"plus \1"),
    (r"\bgov\.uk\b", "gov dot U K"),
    (r"\bHMRC\b", "H M R C"),
    (r"\bHEIC\b", "H E I C"),
    (r"\bPNG\b", "P N G"),
    (r"\bJPG\b", "J P G"),
    (r"\bPDF\b", "P D F"),
    (r"\bGPS\b", "G P S"),
    (r"\bP45\b", "P forty-five"),
    (r"\bNI\b", "N I"),
    (r"\bAI\b", "A I"),
    (r"\bPPE\b", "P P E"),
    (r"\b12:00\b", "twelve noon"),
    (r"\bMB\b", "megabytes"),
    (r"\b(\d+) m\b", r"\1 metres"),
    (r"\s*[·•]\s*", ", "),
    (r"\s*→\s*", " to "),
    (r"[“”]", ""),
    (r"\s+", " "),
]


def speakable(text: str) -> str:
    for pattern, repl in SPOKEN:
        text = re.sub(pattern, repl, text)
    return text.strip()


def synth(text: str) -> dict:
    key = hashlib.sha1(f"{VOICE}|{SPEED}|{text}".encode()).hexdigest()
    path = os.path.join(CACHE, f"{key}.wav")
    if not os.path.exists(path):
        with lock:
            if not os.path.exists(path):
                samples, rate = kokoro.create(speakable(text), voice=VOICE, speed=SPEED, lang="en-gb")
                sf.write(path + ".tmp.wav", samples, rate)
                os.replace(path + ".tmp.wav", path)
    return {"file": path, "seconds": round(sf.info(path).duration, 3)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, {"ok": True, "voice": VOICE, "speed": SPEED})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/say":
            self._send(200, synth(body["text"]))
        elif self.path == "/batch":
            texts = body.get("texts", [])
            for text in texts:
                synth(text)
            self._send(200, {"done": len(texts)})
        else:
            self._send(404, {"error": "unknown route"})

    def log_message(self, *args):  # quiet
        pass


if __name__ == "__main__":
    print(f"tts: {VOICE} at speed {SPEED}, cache {CACHE}, port {PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
