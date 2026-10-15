"""Tests for tools/extract-notice-pdf.py. Run: python3 tests/test_extract_notice_pdf.py

PDFs are generated here (no binary fixtures in the repo): one page with a text layer, one blank
scanned-style page. The OCR case runs only when the tesseract binary is installed.
"""
import json, shutil, subprocess, sys, tempfile, unittest
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "extract-notice-pdf.py"


def text_pdf(text):
    """A one-page PDF with a Helvetica text layer, written by hand so no PDF library is needed."""
    stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def blank_scan_pdf():
    """A one-page PDF that is only a raster image: no text layer, so OCR must run on it."""
    img = Image.new("L", (1224, 1584), 255)
    ImageDraw.Draw(img).text((100, 100), "NOTICE 12", fill=0, font=ImageFont.load_default(size=60))
    buf = BytesIO()
    img.save(buf, "PDF", resolution=150)
    return buf.getvalue()


def run_cli(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)


class ExtractNoticePdf(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_pdf(self, name, pdf_bytes):
        path = self.tmp / name
        path.write_bytes(pdf_bytes)
        return path

    def test_text_layer_page_skips_ocr(self):
        pdf = self.write_pdf("native.pdf", text_pdf("Notice 12/2026 water supply"))
        proc = run_cli(str(pdf))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        [result] = json.loads(proc.stdout)
        self.assertEqual(result["source"], "native")
        self.assertEqual(result["page_count"], 1)
        self.assertEqual(result["ocr_pages"], [])
        self.assertIsNone(result["ocr_engine"])
        self.assertIn("Notice 12/2026 water supply", result["text"])
        self.assertEqual(len(result["sha256"]), 64)
        # short notice: flagged for a moderator even without OCR
        self.assertTrue(result["needs_review"])
        self.assertEqual(result["review_reasons"], ["short_text"])

    def test_mixed_pdf_ocrs_only_the_blank_page(self):
        if not shutil.which("tesseract"):
            self.skipTest("tesseract binary not installed")
        writer = PdfWriter()
        writer.append(PdfReader(BytesIO(text_pdf("Notice 12/2026 water supply"))))
        writer.append(PdfReader(BytesIO(blank_scan_pdf())))
        pdf = self.tmp / "mixed.pdf"
        with pdf.open("wb") as fh:
            writer.write(fh)
        proc = run_cli(str(pdf), "--out-dir", str(self.tmp / "out"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads((self.tmp / "out" / "mixed.json").read_text(encoding="utf-8"))
        self.assertEqual(result["page_count"], 2)
        self.assertEqual(result["source"], "mixed")
        self.assertEqual(result["ocr_pages"], [2])
        self.assertEqual(result["ocr_engine"], "tesseract")
        self.assertEqual(result["ocr_dpi"], 300)
        self.assertIn("--- page 1 ---\nNotice 12/2026 water supply", result["text"])
        self.assertIn("ocr_used", result["review_reasons"])
        self.assertTrue(result["needs_review"])

    def test_bad_file_reports_error_and_fails(self):
        bad = self.write_pdf("broken.pdf", b"not a pdf")
        proc = run_cli(str(bad))
        self.assertEqual(proc.returncode, 1)
        [result] = json.loads(proc.stdout)
        self.assertEqual(result["file"], "broken.pdf")
        self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
