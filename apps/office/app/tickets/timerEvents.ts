/** Fired on `window` when a timer starts or stops, so the top bar's chip reads again at once. */
export const TIMER_CHANGED = 'thc:timer-changed';

export function announceTimerChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TIMER_CHANGED));
}
