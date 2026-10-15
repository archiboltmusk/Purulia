#!/usr/bin/env python3
"""Extract text from local notice PDFs: text layer first, OCR only for pages without one.

    python3 tools/extract-notice-pdf.py <pdf> [<pdf> ...] [--out-dir DIR] [--engine tesseract|easyocr] [--binarize]

Per page: the embedded text layer (pypdf) is used when it has text; a page with none is
rendered at 300 DPI (pdf2image) and OCR'd in ben+hin+eng (Tesseract) or bn/hi/en (EasyOCR).
Output is one JSON object per PDF: source (native | ocr | mixed), page count, OCR pages, text,
sha256, and needs_review (set when OCR ran or the text is short). Nothing is fetched or published:
this only reads the local files you pass. Output goes to a moderator queue, never straight to the site.

Setup:
  Debian/Ubuntu: sudo apt-get install -y tesseract-ocr tesseract-ocr-ben tesseract-ocr-hin poppler-utils
  macOS:         brew install tesseract tesseract-lang poppler
  Python:        pip install pypdf pdf2image pytesseract pillow
                 (EasyOCR only: pip install easyocr numpy; it pulls in PyTorch)
"""
import argparse, hashlib, json, sys
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

PAGE_MIN_CHARS = 20  # a page with less text layer than this is treated as scanned
SHORT_TEXT_CHARS = 100  # a whole notice under this is flagged for a moderator
OCR_DPI = 300
TESS_LANG = "ben+hin+eng"
TESS_CONFIG = "--oem 3 --psm 3"
EASY_LANGS = ["bn", "hi", "en"]


class Ocr:
    """Loads the OCR engine on first use, so PDFs with a text layer never need it."""

    def __init__(self, engine, binarize):
        self.engine = engine
        self.binarize = binarize
        self.reader = None
        self.ready = False

    def _ensure(self):
        if self.ready:
            return
        if self.engine == "easyocr":
            import easyocr
            self.reader = easyocr.Reader(EASY_LANGS, gpu=False)
        else:
            import pytesseract
            pytesseract.get_tesseract_version()  # raises if the tesseract binary is missing
        self.ready = True

    def page_text(self, pdf, number):
        from pdf2image import convert_from_path
        self._ensure()
        img = convert_from_path(str(pdf), dpi=OCR_DPI, first_page=number, last_page=number)[0].convert("L")
        if self.binarize:
            img = img.point(lambda p: 255 if p > 160 else 0)
        if self.reader:
            import numpy as np
            return "\n".join(item[1] for item in self.reader.readtext(np.array(img), paragraph=True)).strip()
        import pytesseract
        return pytesseract.image_to_string(img, lang=TESS_LANG, config=TESS_CONFIG).strip()


def native_texts(pdf):
    texts = []
    for page in PdfReader(str(pdf)).pages:
        try:
            texts.append((page.extract_text() or "").strip())
        except Exception:
            texts.append("")  # unparseable text layer: let OCR take the page
    return texts


def extract(pdf, ocr):
    data = Path(pdf).read_bytes()
    pages, ocr_pages = [], []
    texts = native_texts(pdf)
    for number, text in enumerate(texts, 1):
        if len(text) >= PAGE_MIN_CHARS:
            pages.append((number, "native", text))
        else:
            pages.append((number, "ocr", ocr.page_text(pdf, number)))
            ocr_pages.append(number)
    chars = sum(len(text) for _, _, text in pages)
    source = "native" if not ocr_pages else "ocr" if len(ocr_pages) == len(pages) else "mixed"
    reasons = []
    if ocr_pages:
        reasons.append("ocr_used")
    if chars < SHORT_TEXT_CHARS:
        reasons.append("short_text")
    return {
        "file": Path(pdf).name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "page_count": len(texts),
        "source": source,
        "ocr_pages": ocr_pages,
        "ocr_engine": ocr.engine if ocr_pages else None,
        "ocr_dpi": OCR_DPI if ocr_pages else None,
        "char_count": chars,
        "text": "\n\n".join(f"--- page {n} ---\n{text}" for n, _, text in pages),
        "needs_review": bool(reasons),
        "review_reasons": reasons,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Extract notice PDFs: text layer first, OCR for scanned pages.")
    ap.add_argument("pdfs", nargs="+", type=Path)
    ap.add_argument("--out-dir", type=Path, help="write <stem>.json per PDF here; default prints a JSON array")
    ap.add_argument("--engine", choices=["tesseract", "easyocr"], default="tesseract")
    ap.add_argument("--binarize", action="store_true", help="threshold grayscale pages before OCR (bleed-through scans)")
    args = ap.parse_args(argv)

    ocr = Ocr(args.engine, args.binarize)
    results, failed = [], False
    for pdf in args.pdfs:
        try:
            result = extract(pdf, ocr)
        except Exception as e:  # one bad file must not stop the batch
            result = {"file": pdf.name, "error": f"{type(e).__name__}: {e}"}
            failed = True
        results.append(result)
        if args.out_dir:
            args.out_dir.mkdir(parents=True, exist_ok=True)
            out = args.out_dir / (pdf.stem + ".json")
            out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.out_dir:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
