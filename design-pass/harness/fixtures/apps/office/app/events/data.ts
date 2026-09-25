export * from '../../../../../../../apps/office/app/events/data';
import { reference, savedEvent } from '../../../../../rows.mjs';
export async function loadReferenceData() {
  return reference;
}
export async function loadEvent() {
  return savedEvent;
}
