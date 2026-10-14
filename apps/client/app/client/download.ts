/**
 * Hands the browser a file made on the page (ADR-0050's .ics, and ADR-0134
 * N7's file of every upcoming event): a Blob behind a throwaway link. No
 * request is made.
 */
export function saveCalendarFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the click has been handled: revoking at once can cancel the
  // download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
