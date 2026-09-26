export * from '../../../../../../../../apps/office/app/events/[id]/board-data';
import { boardEvent } from '../../../../../../rows.mjs';
export async function loadBoard() {
  return { event: boardEvent, problem: null };
}
