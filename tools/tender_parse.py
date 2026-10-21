#!/usr/bin/env python3
"""Read public tender pages you point it at and print one JSON row per tender.

    python3 tools/tender_parse.py --url https://example.gov.in/tender/123
    python3 tools/tender_parse.py saved-page.html --source-url https://example.gov.in/tender/123

Every row records the source URL and the UTC fetch time. Parsing is label-based
("Tender ID", "Closing Date", "Estimated Cost"); a label that is missing gives null, it is
never guessed. Fetching is a single GET per URL you name: no crawling, no CAPTCHA
solving, no proxies. A page that asks for a CAPTCHA, or any non-200 answer, is refused.

Exit 0 on success (even zero rows), 1 when a fetch is refused, 2 on bad usage.
"""
import argparse, datetime, html.parser, json, re, sys, urllib.error, urllib.request

UA = 'ParishkarTenderParse/1.0 (civic information; https://github.com/archiboltmusk/Purulia)'
CAPTCHA = re.compile(r'captcha', re.I)
UNITS = {'lakh': 100_000, 'lakhs': 100_000, 'crore': 10_000_000, 'crores': 10_000_000}


class _Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self._skip += 1
        elif tag in ('br', 'p', 'tr', 'li', 'div', 'h1', 'h2', 'h3', 'h4', 'td', 'th'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def visible_text(markup):
    p = _Text()
    p.feed(markup)
    return re.sub(r'[ \t\xa0]+', ' ', ''.join(p.parts))


def _iso_date(raw):
    m = re.fullmatch(r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})', raw.strip())
    if not m:
        return None
    try:
        return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
    except ValueError:
        return None


def _inr(raw, unit):
    n = float(raw.replace(',', ''))
    mult = UNITS.get((unit or '').lower(), 1)
    return int(round(n * mult))


FIELDS = {
    'tender_id': re.compile(r'Tender\s*(?:ID|No\.?|Number)\s*[:\-]\s*([A-Za-z0-9/_.\-]+)', re.I),
    'title': re.compile(r'(?:Tender\s*Title|Name\s*of\s*Work|Work\s*Description|Title)\s*[:\-]\s*([^\n]{3,300})', re.I),
    'organisation': re.compile(r'(?:Organisation|Organization|Department)\s*[:\-]\s*([^\n]{3,200})', re.I),
    'closing_date': re.compile(r'Closing\s*Date\s*[:\-]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})', re.I),
    'value_inr': re.compile(r'(?:Estimated\s*Cost|Tender\s*Value|Estimated\s*Value)\s*[:\-]?\s*(?:Rs\.?|₹|INR)?\s*'
                            r'([\d][\d,]*(?:\.\d+)?)\s*(lakhs?|crores?)?', re.I),
}


def parse_text(text, source_url, fetched_at):
    """One row per 'Tender ID' label. Each row's fields come from the text up to the next label."""
    starts = [m.start() for m in FIELDS['tender_id'].finditer(text)]
    rows = []
    for i, start in enumerate(starts):
        block = text[start:starts[i + 1] if i + 1 < len(starts) else len(text)]
        row = {'tender_id': None, 'title': None, 'organisation': None, 'closing_date': None,
               'value_inr': None, 'source_url': source_url, 'fetched_at': fetched_at}
        m = FIELDS['tender_id'].search(block)
        row['tender_id'] = m.group(1).strip() if m else None
        for key in ('title', 'organisation'):
            m = FIELDS[key].search(block)
            row[key] = m.group(1).strip() if m else None
        m = FIELDS['closing_date'].search(block)
        row['closing_date'] = _iso_date(m.group(1)) if m else None
        m = FIELDS['value_inr'].search(block)
        row['value_inr'] = _inr(m.group(1), m.group(2)) if m else None
        rows.append(row)
    return rows


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml'})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status != 200:
                raise RuntimeError(f'HTTP {res.status}')
            body = res.read(5_000_000).decode('utf-8', errors='replace')
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f'HTTP {ex.code}') from ex
    if CAPTCHA.search(body):
        raise RuntimeError('page asks for a CAPTCHA; refused')
    return body


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file', nargs='?', help='saved HTML page (needs --source-url)')
    ap.add_argument('--url', help='public tender page to fetch once')
    ap.add_argument('--source-url', help='where a saved file came from')
    args = ap.parse_args(argv)
    if bool(args.file) == bool(args.url):
        ap.error('give a saved file or --url, not both')
    fetched_at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if args.url:
        try:
            markup = fetch(args.url)
        except (RuntimeError, urllib.error.URLError, TimeoutError) as ex:
            print(f'refused: {args.url}: {ex}', file=sys.stderr)
            return 1
        source = args.url
    else:
        if not args.source_url:
            ap.error('a saved file needs --source-url so each row keeps where it came from')
        with open(args.file, encoding='utf-8', errors='replace') as f:
            markup = f.read()
        source = args.source_url
    rows = parse_text(visible_text(markup), source, fetched_at)
    json.dump(rows, sys.stdout, ensure_ascii=False, indent=1)
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
