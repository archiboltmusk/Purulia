#!/usr/bin/env python3
"""Clean Bengali and Hindi OCR text, then pull out ward numbers and LGD admin units.

    python3 tools/notice-indic-text.py <extract.json> [...] --lgd <lgd_export.csv> [--out-dir DIR]

Input: JSON written by tools/extract-notice-pdf.py (its "text" field is cleaned).
--lgd: the official LGD export as CSV with columns lgd_code,name,level and optional name_local.
  Codes come only from that file; none are hard-coded here. Without --lgd no admin units are matched.
Output: the input JSON plus cleaned_text, wards and admin_units. needs_review is also set when
no ward or no admin unit was found. Nothing is published: the output goes to the moderator queue.
Fuzzy matching uses rapidfuzz when installed, else difflib (slower, same scale of score).
"""
import argparse, csv, difflib, json, re, sys
import unicodedata
from pathlib import Path

try:
    from rapidfuzz import fuzz as _rf
except ImportError:
    _rf = None

BENGALI_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
ZERO_WIDTH = re.compile("[​‌‍­﻿]")  # also drops ZWJ/ZWNJ inside valid conjuncts
HASANT_GAP = re.compile("([্्])[ \t]+(?=[ক-হक-ह])")  # 'ক্ ষ' -> 'ক্ষ'
DANDA = re.compile("[।॥]")
NOISE = re.compile(r"[~|_=*\-]{2,}")  # xerox border marks
SPACES = re.compile(r"[ \t]+")

ROMAN = {
    "i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10,
    "xi": 11, "xii": 12, "xiii": 13, "xiv": 14, "xv": 15, "xvi": 16, "xvii": 17, "xviii": 18, "xix": 19, "xx": 20,
}
WARD_PATTERNS = [
    r"(?<![a-z])(?:ward|w)[\s.:#\-_]*(?:no\.?|nos?\.?|number)?[\s.:#\-_]*([0-9]{1,3}|[ivx]+)(?![a-z0-9])",
    r"ওয়ার্ড[\s.:#\-_]*(?:নং\.?|নম্বর)?[\s.:#\-_]*([0-9]{1,3})",
    r"([0-9]{1,3})[\s.]*(?:নং\.?|নম্বর)?[\s.]*ওয়ার্ড",
    r"वार्ड[\s.:#\-_]*(?:नं\.?|नंबर|क्रमांक)?[\s.:#\-_]*([0-9]{1,3})",
]
ADMIN_KEYWORDS = [
    "block", "development block", "panchayat", "gram panchayat", "municipality", "corporation",
    "ব্লক", "সমষ্টি উন্নয়ন ব্লক", "গ্রাম পঞ্চায়েত", "পৌরসভা", "প্রখণ্ড",
    "ब्लॉक", "ग्राम पंचायत", "नगर पालिका",
]
FUZZY_MIN = 85
MIN_NAME_CHARS = 3


def partial_ratio(needle, hay):
    """Best similarity of needle against any window of hay, 0-100 (rapidfuzz semantics)."""
    if _rf:
        return _rf.partial_ratio(needle, hay)
    n = len(needle)
    if n == 0 or not hay:
        return 0
    if len(hay) <= n:
        return 100 * difflib.SequenceMatcher(None, needle, hay).ratio()
    best = 0.0
    for i in range(len(hay) - n + 1):
        best = max(best, difflib.SequenceMatcher(None, needle, hay[i:i + n]).ratio())
        if best == 1:
            break
    return 100 * best


def clean_text(text):
    """NFC, digit mapping, invisible-character and danda cleanup. Keeps one line per sentence."""
    if not text:
        return ""
    s = unicodedata.normalize("NFC", text)
    s = s.translate(BENGALI_DIGITS).translate(DEVANAGARI_DIGITS)
    s = ZERO_WIDTH.sub("", s)
    s = HASANT_GAP.sub(r"\1", s)
    s = DANDA.sub(".\n", s)
    s = NOISE.sub(" ", s)
    lines = (SPACES.sub(" ", line).strip() for line in s.split("\n"))
    return "\n".join(line for line in lines if line)


def ward_numbers(cleaned):
    wards = set()
    low = cleaned.lower()
    for pattern in WARD_PATTERNS:
        for match in re.finditer(pattern, low):
            val = match.group(1)
            num = ROMAN.get(val) if val.isalpha() else int(val)
            if num and 1 <= num <= 200:
                wards.add(num)
    return sorted(wards)


def admin_units(cleaned, catalog):
    """catalog: lowercased name -> list of {lgd_code, level}. Only lines with an admin keyword count."""
    found = {}
    for line in cleaned.split("\n"):
        low = line.lower()
        if not any(k in low for k in ADMIN_KEYWORDS):
            continue
        for name, metas in catalog.items():
            score = partial_ratio(name, low)
            if score < FUZZY_MIN:
                continue
            for meta in metas:
                code = meta["lgd_code"]
                if code not in found or score > found[code]["confidence"]:
                    found[code] = {"matched_name": name, "lgd_code": code, "level": meta["level"],
                                   "confidence": round(score, 1)}
    return sorted(found.values(), key=lambda u: -u["confidence"])


def load_lgd(path):
    catalog = {}
    with open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            code = (row.get("lgd_code") or "").strip()
            if not code:
                raise ValueError(f"LGD row without lgd_code: {row}")
            meta = {"lgd_code": code, "level": (row.get("level") or "").strip()}
            for col in ("name", "name_local"):
                name = clean_text(row.get(col) or "").lower()
                if len(name) >= MIN_NAME_CHARS:
                    catalog.setdefault(name, []).append(meta)
    return catalog


def analyse(text, catalog):
    cleaned = clean_text(text)
    return {"cleaned_text": cleaned, "wards": ward_numbers(cleaned),
            "admin_units": admin_units(cleaned, catalog)}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Clean Bengali/Hindi notice text; find wards and LGD units.")
    ap.add_argument("inputs", nargs="+", type=Path, help="JSON from extract-notice-pdf.py")
    ap.add_argument("--lgd", type=Path, help="official LGD export CSV (lgd_code,name,level[,name_local])")
    ap.add_argument("--out-dir", type=Path, help="write <stem>.json per input here; default prints a JSON array")
    args = ap.parse_args(argv)

    catalog = load_lgd(args.lgd) if args.lgd else {}
    results, failed = [], False
    for path in args.inputs:
        data = json.loads(path.read_text(encoding="utf-8"))
        if "error" in data:
            result = data
            failed = True
        else:
            result = {**data, **analyse(data.get("text", ""), catalog)}
            result["needs_review"] = bool(data.get("needs_review")) or not result["wards"] or not result["admin_units"]
        results.append(result)
        if args.out_dir:
            args.out_dir.mkdir(parents=True, exist_ok=True)
            (args.out_dir / (path.stem + ".json")).write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.out_dir:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
