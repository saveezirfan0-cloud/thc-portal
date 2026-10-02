"""Renders every page of the given PDFs to PNG (200 dpi) next to them: x.pdf -> x-p1.png, x-p2.png ...
Needs `pip install pymupdf`. Used by ts-prep.mjs for the timesheet video."""
import sys

import pymupdf

for path in sys.argv[1:]:
    doc = pymupdf.open(path)
    for i, page in enumerate(doc):
        page.get_pixmap(dpi=200).save(path.replace(".pdf", f"-p{i + 1}.png"))
    print(path, len(doc), "pages")
