import { readProfile } from '../profile/data';
import { timeFormatChoice } from '../_lib/timeFormat';

/**
 * Start `StaffShell`'s own reads now, alongside the page's (go-live audit
 * M2). The shell renders only after the page's `Promise.all` has resolved,
 * so without this `staff_me()` and the clock cookie were a serial stage of
 * their own on every working screen.
 *
 * Both reads are `React.cache`d per request: the shell's later call is
 * handed the promise started here, never a second RPC. Nothing is awaited
 * and nothing is decided — the lock is still applied by the shell, from the
 * same read. A failure is the shell's to show; the `catch` here only stops
 * this early start from counting as an unhandled rejection.
 */
export function preloadShell(): void {
  for (const read of [readProfile, timeFormatChoice] as Array<() => Promise<unknown>>) {
    try {
      void read().catch(() => {});
    } catch {
      // Outside a request (a test, a build-time render): nothing to start.
    }
  }
}
