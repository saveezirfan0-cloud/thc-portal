'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type SpeechRecognitionLike,
  dictationProblem,
  speechRecognitionOf,
} from '../_lib/dictation';

/**
 * A "Dictate" button for a text field (ADR-0202): press it, say what the
 * issue is, and each finished phrase is handed to `onText`; press it again
 * (or go quiet) to stop. It uses the browser's own speech recogniser
 * (Chrome, Edge and Safari have one; Firefox does not, and there the button
 * says so instead of vanishing). The browser sends the audio to its speech
 * service, which the hint says.
 */
export function DictateButton({
  onText,
  disabled,
  label = 'Dictate',
}: {
  /** One finished phrase, as spoken. */
  onText: (spoken: string) => void;
  disabled?: boolean;
  /** Names the field for a screen reader: "Dictate details". */
  label?: string;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const recogniser = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // Support is a property of the browser, known only after mount.
  useEffect(() => {
    setSupported(speechRecognitionOf(window) !== null);
    return () => recogniser.current?.abort();
  }, []);

  const stop = () => recogniser.current?.stop();

  const start = () => {
    const Ctor = speechRecognitionOf(window);
    if (!Ctor) return;
    setProblem(null);
    setHearing('');
    const r = new Ctor();
    r.lang = 'en-GB';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0].transcript;
        if (result.isFinal) onTextRef.current(text);
        else interim += text;
      }
      setHearing(interim);
    };
    r.onerror = (event) => {
      const said = dictationProblem(event.error);
      if (said) setProblem(said);
    };
    r.onend = () => {
      setListening(false);
      setHearing('');
      recogniser.current = null;
    };
    recogniser.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      recogniser.current = null;
      setProblem('Voice typing could not start. Try again, or type it.');
    }
  };

  if (supported === null) return null;

  if (!supported) {
    return (
      <span className="dictate">
        <button
          type="button"
          className="btn sm"
          disabled
          title="Voice typing works in Chrome, Edge and Safari"
        >
          <Mic /> {label}
        </button>
        <span className="hint">Voice typing needs Chrome, Edge or Safari.</span>
      </span>
    );
  }

  return (
    <span className="dictate">
      <button
        type="button"
        className={listening ? 'btn sm primary' : 'btn sm'}
        aria-pressed={listening}
        aria-label={listening ? `Stop dictating` : label}
        disabled={disabled}
        title="Your browser sends the audio to its own speech service to turn it into text"
        onClick={listening ? stop : start}
      >
        <Mic /> {listening ? 'Stop' : label}
      </button>
      <span className="hint" role="status" aria-live="polite">
        {listening ? (hearing ? `Hearing: ${hearing}` : 'Listening… speak now') : null}
      </span>
      {problem ? (
        <span className="error" role="alert">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

function Mic() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
