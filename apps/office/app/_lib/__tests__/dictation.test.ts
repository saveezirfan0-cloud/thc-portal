import { describe, expect, it } from 'vitest';
import { appendDictation, dictationProblem, speechRecognitionOf } from '../dictation';

describe('appendDictation', () => {
  it('starts a field with a capital', () => {
    expect(appendDictation('', 'the kanban card vanishes', 5000)).toBe('The kanban card vanishes');
  });

  it('joins a phrase to a sentence in progress with one space and no new capital', () => {
    expect(appendDictation('I dragged a card', 'and it vanished', 5000)).toBe(
      'I dragged a card and it vanished',
    );
  });

  it('capitalises after a full stop, a question mark or a closing quote', () => {
    expect(appendDictation('It broke.', 'then I refreshed', 5000)).toBe(
      'It broke. Then I refreshed',
    );
    expect(appendDictation('Did it save?', 'no it did not', 5000)).toBe(
      'Did it save? No it did not',
    );
    expect(appendDictation('He said "stop."', 'we did', 5000)).toBe('He said "stop." We did');
  });

  it('writes on the next line without a leading space', () => {
    expect(appendDictation('First line\n', 'second line', 5000)).toBe('First line\nSecond line');
  });

  it('collapses the recogniser’s stray spaces and ignores silence', () => {
    expect(appendDictation('Hello', '  there   you ', 5000)).toBe('Hello there you');
    expect(appendDictation('Hello', '   ', 5000)).toBe('Hello');
  });

  it('never goes past the field’s own cap', () => {
    expect(appendDictation('abcde', 'fghij', 8)).toHaveLength(8);
  });
});

describe('the browser’s recogniser', () => {
  it('prefers the standard name and falls back to webkit’s', () => {
    class A {}
    class B {}
    expect(speechRecognitionOf({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A);
    expect(speechRecognitionOf({ webkitSpeechRecognition: B })).toBe(B);
  });

  it('is null where there is none', () => {
    expect(speechRecognitionOf({})).toBeNull();
    expect(speechRecognitionOf(null)).toBeNull();
  });

  it('turns an error code into a sentence, and says nothing for silence', () => {
    expect(dictationProblem('not-allowed')).toMatch(/microphone is blocked/);
    expect(dictationProblem('audio-capture')).toMatch(/No microphone/);
    expect(dictationProblem('network')).toMatch(/internet connection/);
    expect(dictationProblem('no-speech')).toBeNull();
    expect(dictationProblem('aborted')).toBeNull();
    expect(dictationProblem('something-new')).toMatch(/stopped unexpectedly/);
  });
});
