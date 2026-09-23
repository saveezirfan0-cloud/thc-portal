import type { DocType } from '@thc/domain';

/**
 * Where a worker's onboarding upload lives in the private `documents`
 * bucket: `<staff_id>/<doc_type>/<uuid>.<ext>`.
 *
 * The server builds it from the session when it mints the signed upload
 * URL, and checks it again — against the session, not the request — before
 * it does anything else with the service key. The second check is what
 * stops a forged "finish" call naming someone else's file from reaching a
 * service-key read or delete. `onboarding_attach_document()` refuses a
 * foreign prefix as well, but it runs after, and as the worker.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function documentPath(staffId: string, docType: DocType, id: string, ext: string): string {
  return `${staffId}/${docType}/${id}.${ext}`;
}

export function isOwnDocumentPath(staffId: string, docType: DocType, path: string): boolean {
  if (!/^[0-9a-f-]{36}$/.test(staffId) || !/^[a-z_]+$/.test(docType)) return false;
  return new RegExp(`^${staffId}/${docType}/${UUID}\\.(pdf|jpg|png|heic)$`).test(path);
}
