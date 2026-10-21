import { Alert } from '@thc/ui';

/**
 * ADR-0184: a security-cleared event — the worker brings a passport or
 * driving licence. Drawn at the top of the shift screen for a confirmed
 * booking, which is where the SC1 push lands.
 *
 * Information only. Nothing about check-in changes (§5.1) and the office's
 * words are not invented here: the owner said to bring one of the two.
 */
export function SecurityCleared() {
  return (
    <Alert tone="amber">
      <span data-testid="bring-id">
        <b>Bring ID.</b> This is a security-cleared event — bring your passport or driving licence
        with you.
      </span>
    </Alert>
  );
}
