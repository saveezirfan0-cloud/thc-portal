/**
 * Screen capture for the Ticket button (ADR-0204): a screenshot, or a screen
 * recording, of the tab, window or screen the reporter picks. Browser only
 * (`getDisplayMedia`); phones and Safari on iOS have none, and the button
 * says so instead of vanishing. Nothing leaves the browser until the ticket
 * is sent.
 */

import { baseMime } from '../tickets/ticket-files';

interface DisplayMediaDevices {
  getDisplayMedia(options?: Record<string, unknown>): Promise<MediaStream>;
}

function devices(): DisplayMediaDevices | null {
  if (typeof navigator === 'undefined') return null;
  const media = navigator.mediaDevices as Partial<DisplayMediaDevices> | undefined;
  return media && typeof media.getDisplayMedia === 'function'
    ? (media as DisplayMediaDevices)
    : null;
}

/** Can this browser capture the screen at all? Known only after mount. */
export function screenshotSupported(): boolean {
  return devices() !== null;
}

/** Can it also record it? */
export function recordingSupported(): boolean {
  return devices() !== null && typeof MediaRecorder !== 'undefined';
}

/** What the person did instead of capturing: said no, or there was nothing to share. */
export function captureProblem(error: unknown): string | null {
  const name = error instanceof DOMException ? error.name : '';
  // They closed the picker. Not an error worth a message.
  if (name === 'NotAllowedError' || name === 'AbortError') return null;
  if (name === 'NotFoundError') return 'There was no screen to share.';
  return 'The screen could not be captured in this browser. Attach a file instead.';
}

/** One PNG of whatever the person picks. Call from a click, so the browser lets it ask. */
export async function captureScreenshot(): Promise<Blob> {
  const media = devices();
  if (!media) throw new DOMException('No screen capture', 'NotSupportedError');
  const stream = await media.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The picker and the closing dialog must be gone from the first frame.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Empty image'))),
        'image/png',
      ),
    );
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

export interface Recording {
  /** Stop and hand over the file. Safe to call twice. */
  stop(): void;
  /** Resolves once, with the video, whoever stopped it (the button, the timer or the browser's own Stop sharing). */
  done: Promise<Blob>;
}

const RECORDER_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

function recorderType(): string | undefined {
  return RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Start recording the picked screen. Stops by itself after `maxSeconds`. */
export async function startRecording(
  maxSeconds: number,
  bitsPerSecond: number,
): Promise<Recording> {
  const media = devices();
  if (!media || typeof MediaRecorder === 'undefined') {
    throw new DOMException('No screen recording', 'NotSupportedError');
  }
  const stream = await media.getDisplayMedia({ video: true, audio: false });
  try {
    const mimeType = recorderType();
    const recorder = new MediaRecorder(stream, {
      videoBitsPerSecond: bitsPerSecond,
      ...(mimeType ? { mimeType } : {}),
    });
    const chunks: Blob[] = [];

    const done = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        clearTimeout(timer);
        stream.getTracks().forEach((track) => track.stop());
        resolve(
          new Blob(chunks, { type: baseMime(recorder.mimeType || mimeType || 'video/webm') }),
        );
      };
    });

    const stop = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const timer = setTimeout(stop, maxSeconds * 1000);
    // The browser's own "Stop sharing" ends the track.
    stream.getVideoTracks()[0]?.addEventListener('ended', stop);
    recorder.start(1000);
    return { stop, done };
  } catch (error) {
    // Sharing must not stay on if the recorder could not start.
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
