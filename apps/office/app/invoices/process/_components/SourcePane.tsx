'use client';

import { useEffect, useState } from 'react';
import { EmptyState, SegToggle } from '@thc/ui';
import { sizeLabel } from '../validators';
import type { ShiftSource, SourceFile } from '../types';

/**
 * "Source document" (audit §2.2): the upload the reviewer is checking the
 * rows against. A PDF or image is shown inline from a short-lived signed
 * URL; a spreadsheet is a read-only table, a tab per worksheet. Choosing a
 * row on the right jumps here to the file, the sheet and (for a
 * spreadsheet) the line it was read from.
 */
export function SourcePane({
  files,
  focus,
}: {
  files: SourceFile[];
  focus: { fileId: string | null; source: ShiftSource | null; nonce: number } | null;
}) {
  const [fileId, setFileId] = useState(files[0]?.id ?? '');
  const [sheet, setSheet] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [page, setPage] = useState<number | null>(null);

  useEffect(() => {
    if (!focus) return;
    const target = files.find((f) => f.id === focus.fileId) ?? files.find((f) => f.id === fileId);
    if (target) setFileId(target.id);
    const src = focus.source;
    if (src?.type === 'excel') {
      const index = target?.sheets.findIndex((s) => s.name === src.sheet) ?? -1;
      if (index >= 0) setSheet(index);
      setHighlight(src.row);
    } else {
      setHighlight(null);
    }
    setPage(focus.source?.type === 'pdf-table' ? focus.source.page : null);
    // `nonce` makes choosing the same row twice scroll again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => {
    if (highlight === null) return;
    document.getElementById(`pr-src-row-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [highlight, sheet, fileId]);

  const file = files.find((f) => f.id === fileId) ?? files[0];
  if (!file) {
    return (
      <EmptyState>
        <p className="muted sm">No source file on this job.</p>
      </EmptyState>
    );
  }
  const current = file.sheets[Math.min(sheet, Math.max(file.sheets.length - 1, 0))];

  return (
    <div className="pr-source">
      <div className="pr-source-head">
        <div className="pr-source-name">
          <span className="strong" title={file.fileName}>
            {file.fileName}
          </span>
          <span className="xs muted">{sizeLabel(file.sizeBytes)}</span>
        </div>
        {file.url ? (
          <a className="btn sm" href={file.url} download={file.fileName}>
            Download
          </a>
        ) : (
          <span className="xs muted">Download unavailable</span>
        )}
      </div>

      {files.length > 1 ? (
        <SegToggle
          small
          aria-label="Source files"
          value={file.id}
          onChange={(v) => {
            setFileId(v);
            setSheet(0);
            setHighlight(null);
          }}
          options={files.map((f, i) => ({ value: f.id, label: `File ${i + 1}` }))}
        />
      ) : null}

      {file.kind === 'pdf' && file.url ? (
        <iframe
          className="pr-frame"
          title={`Source document ${file.fileName}`}
          src={page ? `${file.url}#page=${page}` : file.url}
        />
      ) : null}
      {file.kind === 'image' && file.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, signed, short-lived URL
        <img className="pr-image" src={file.url} alt={`Source document ${file.fileName}`} />
      ) : null}
      {file.kind === 'sheet' ? (
        file.sheets.length > 0 && current ? (
          <>
            {file.sheets.length > 1 ? (
              <div className="pr-sheet-tabs" role="tablist" aria-label="Worksheets">
                {file.sheets.map((s, i) => (
                  <button
                    key={s.name + i}
                    type="button"
                    role="tab"
                    aria-selected={i === sheet}
                    className={i === sheet ? 'on' : undefined}
                    onClick={() => {
                      setSheet(i);
                      setHighlight(null);
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="pr-sheet" tabIndex={0} role="region" aria-label={`Worksheet ${current.name}`}>
              <table className="mini">
                <tbody>
                  {current.rows.map((cells, r) => (
                    <tr
                      key={r}
                      id={`pr-src-row-${r + 1}`}
                      className={highlight === r + 1 ? 'pr-src-hit' : undefined}
                    >
                      <th scope="row">{r + 1}</th>
                      {cells.map((c, i) => (
                        <td key={i}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {current.truncated ? (
                <p className="xs muted">Showing the first rows and columns only — download the file for the rest.</p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="sm muted">{file.previewNote ?? 'This file has no sheets to show.'}</p>
        )
      ) : null}
      {file.kind === 'other' || ((file.kind === 'pdf' || file.kind === 'image') && !file.url) ? (
        <p className="sm muted">A preview is not available — use Download.</p>
      ) : null}
    </div>
  );
}
