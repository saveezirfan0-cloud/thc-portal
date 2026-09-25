import { notFound } from 'next/navigation';
import { Alert } from '@thc/ui';
import { DOC_LABELS, isDocType, usesGenericUpload } from '@thc/domain';
import { NotAvailable, SubScreen } from '../../_components/SubScreen';
import { UploadForm } from '../../_components/UploadForm';
import { buildDocumentsView, rowForType } from '../../model';
import { loadRtwCheckEnabled } from '../../../_lib/rtwCheck';
import '../../../staff-app.css';
import '../../documents.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload · Documents · THC Staff' };

/**
 * Upload / Re-upload one document (§10.4, §4.1) — where the row's Upload
 * button and N8's Re-upload deep link land.
 *
 * The row's own state is repeated at the top — the rejection reason word
 * for word, or the expiry — so the worker knows what the office needs
 * before choosing a file.
 */
export default async function Page({ params }: { params: Promise<{ docType: string }> }) {
  const { docType } = await params;
  if (!isDocType(docType)) notFound();
  if (!usesGenericUpload(docType)) notFound();
  const label = DOC_LABELS[docType];
  const automaticCheck = docType === 'share_code_report' && (await loadRtwCheckEnabled());

  return (
    <SubScreen title={docType === 'share_code_report' ? 'New share code' : `Upload · ${label}`}>
      {(data) => {
        const view = buildDocumentsView(data);
        if (!view.canUpload) {
          return (
            <NotAvailable>
              Uploads aren’t available on your account right now. Please contact the office at:
              admin@thehospitalitycompany.co.uk
            </NotAvailable>
          );
        }
        const row = rowForType(view, docType);
        if (row?.state === 'in_review') {
          return (
            <NotAvailable>
              Your {label.toLowerCase()} is already with the office for review. You’ll get a
              notification when it has been checked.
            </NotAvailable>
          );
        }
        return (
          <>
            {row &&
            (row.state === 'rejected' || row.state === 'expired' || row.state === 'expiring') ? (
              <Alert tone={row.state === 'expiring' ? 'amber' : 'coral'}>
                <b>{row.title}</b>
                <br />
                <span className="xs">{row.meta}</span>
              </Alert>
            ) : null}
            <UploadForm docType={docType} label={label} automaticCheck={automaticCheck} />
          </>
        );
      }}
    </SubScreen>
  );
}
