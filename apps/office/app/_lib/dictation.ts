/**
 * Voice typing (ADR-0202): the pure half. The browser's speech recogniser
 * hands back finished phrases ("the kanban card vanishes after I drag it");
 * this joins one onto what is already typed so a dictated report reads as
 * written: one space between, a capital at the start of a sentence, and never
 * past the field's own cap.
 */

/** A phrase added to the end of `existing`; `existing` unchanged when nothing was said. */
export function appendDictation(existing: string, spoken: string, max: number): string {
  const phrase = spoken.replace(/\s+/g, ' ').trim();
  if (!phrase) return existing;
  const before = existing.replace(/[ \t]+$/, '');
  const startsSentence = before === '' || /[.!?]["')\]]*$/.test(before) || /\n$/.test(before);
  const cased = startsSentence ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  const joined = before === '' || /\n$/.test(before) ? before + cased : `${before} ${cased}`;
  return joined.slice(0, max);
}

/** The slice of the Web Speech API this screen uses. TypeScript's DOM lib does not ship it. */
export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
export interface SpeechEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResultLike };
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's recogniser, or null where there is none (Firefox, most embedded browsers). */
export function speechRecognitionOf(win: unknown): SpeechRecognitionCtor | null {
  const w = win as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  } | null;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

/** A recogniser's error code as a sentence the person can act on; null for the harmless ones. */
export function dictationProblem(code: string): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it from the address bar, then try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Voice typing needs an internet connection: the browser sends the audio to its own speech service.';
    case 'language-not-supported':
      return 'This browser cannot dictate in British English.';
    default:
      return 'Voice typing stopped unexpectedly. Try again, or type it.';
  }
}
