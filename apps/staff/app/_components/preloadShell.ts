import { readProfile } from '../profile/data';
import { signOwnPhoto } from '../profile/photos';
import { timeFormatChoice } from '../_lib/timeFormat';

/**
 * Start `StaffShell`'s own reads now, alongside the page's (go-live audit
 * M2). The shell renders only after the page's `Promise.all` has resolved,
 * so without this `staff_me()` and the clock cookie were a serial stage of
 * their own on every working screen.
 *
 * The header avatar's signed URL is started too, as soon as `staff_me()`
 * names the photo (audit M5). Before, the shell signed it only once the
 * page had finished all its reads, which added one more serial stage to
 * every screen. Now it is signed while the page's second wave of reads
 * runs (Documents' documents and right-to-work checks, for example).
 *
 * All three reads are `React.cache`d per request: the shell's later calls
 * are handed the promises started here, never a second RPC or a second
 * signature. Nothing is awaited and nothing is decided. The lock is still
 * applied by the shell, from the same read, and the shell signs the photo
 * whatever the lock is, so starting it early shows nobody anything new. A
 * failure is the shell's to show; the `catch` here only stops this early
 * start from counting as an unhandled rejection.
 */
export function preloadShell(): void {
  const start = (read: () => Promise<unknown>) => {
    try {
      void read().catch(() => {});
    } catch {
      // Outside a request (a test, a build-time render): nothing to start.
    }
  };
  start(() =>
    readProfile().then((read) =>
      read.kind === 'ok' ? signOwnPhoto(read.profile.photoPath ?? null) : null,
    ),
  );
  start(timeFormatChoice);
}
