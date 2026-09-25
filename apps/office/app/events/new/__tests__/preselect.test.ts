import { describe, expect, it } from 'vitest';
import { preselectClient } from '../preselect';

/** `/events/new?client=<id>` from "+ New event for this client" (§9.7). */
describe('preselectClient', () => {
  const clients = [
    { id: 'c1', name: 'Leonardo Hotel St Pauls', staffContactPoint: 'Front desk' },
    { id: 'c2', name: 'The Dorchester', staffContactPoint: 'Banqueting office' },
  ];

  it('picks the client the card linked from', () => {
    expect(preselectClient(clients, 'c2')?.name).toBe('The Dorchester');
  });

  it('opens with the picker empty for a missing, unknown or empty id', () => {
    expect(preselectClient(clients, undefined)).toBeUndefined();
    expect(preselectClient(clients, '')).toBeUndefined();
    expect(preselectClient(clients, 'c-deleted')).toBeUndefined();
  });

  it('takes the first of a repeated parameter', () => {
    expect(preselectClient(clients, ['c1', 'c2'])?.id).toBe('c1');
  });
});
