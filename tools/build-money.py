#!/usr/bin/env python3
"""Tax and spending by place, for money.html (money.js).

    python3 tools/build-money.py            # RBI + MPLADS + checked audit figures
    python3 tools/build-money.py --no-net   # skip the MPLADS download, keep the old MPLADS block

Three sources, each kept with its link:
- RBI, Handbook of Statistics on Indian States 2024-25, Tables 166 (revenue expenditure),
  168 (own tax revenue) and 173 (capital expenditure), Rs crore, state-wise. rbi.org.in blocks
  scripted downloads, so the three XLSX files are kept in tools/data/rbi/ (download them again
  in a browser from the Handbook page when RBI publishes a new edition, same file names).
- MPLADS (the MP's local area fund): every sitting MP's allocation and amount spent, from the
  MPLADS portal as published by Empowered Indian (api.empoweredindian.in), summed per state.
  West Bengal seats are drawn from places/wb_mplads.json (tools/build-wb-reps.py).
- CAG State Finances Audit Reports: tools/data/cag_sfar.json, figures copied by hand from each
  report with its page, never computed or guessed. A state with no entry shows "not on file".
Writes places/money.json.
"""
import json, subprocess, sys, time, zipfile, re
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
RBI_DIR = ROOT / 'tools/data/rbi'
OUT = ROOT / 'places/money.json'
RBI_PAGE = 'https://rbi.org.in/Scripts/AnnualPublications.aspx?head=Handbook+of+Statistics+on+Indian+States'
RBI_FILES = {
    'ownTax': ('t168_own_tax_revenue.xlsx', 'Table 168: State-wise Own Tax Revenue',
               'https://rbidocs.rbi.org.in/rdocs/Publications/DOCs/168T_111220256B7415AC1AB24E97B4EECEB4FB7055C0.XLSX'),
    'revExp': ('t166_revenue_expenditure.xlsx', 'Table 166: State-wise Revenue Expenditure',
               'https://rbidocs.rbi.org.in/rdocs/Publications/DOCs/166T_11122025312B8C5D05BA435B980E3658F96541C4.XLSX'),
    'capExp': ('t173_capital_expenditure.xlsx', 'Table 173: State-wise Capital Expenditure',
               'https://rbidocs.rbi.org.in/rdocs/Publications/DOCs/173T_111220258D78C5BE1521455588EC9842ECC3D997.XLSX'),
}
# RBI / Empowered Indian state name -> places/in_states.geojson name, where they differ.
ALIAS = {'Jammu & Kashmir': 'Jammu and Kashmir', 'NCT Delhi': 'Delhi', 'NCT of Delhi': 'Delhi',
         'Jammu And Kashmir': 'Jammu and Kashmir', 'Andaman And Nicobar Islands': 'Andaman and Nicobar Islands',
         'Dadra And Nagar Haveli And Daman And Diu': 'Dadra and Nagar Haveli and Daman and Diu',
         'The Dadra And Nagar Haveli And Daman And Diu': 'Dadra and Nagar Haveli and Daman and Diu'}
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def sheets(path):
    """Every sheet of an XLSX as rows of cell values (stdlib only, no openpyxl)."""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    names = sorted((n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n)),
                   key=lambda n: int(re.search(r'(\d+)', n.rsplit('/', 1)[1]).group(1)))
    for n in names:
        rows = []
        for r in ET.fromstring(z.read(n)).iter('{%s}row' % NS['m']):
            cells = {}
            for c in r.findall('m:c', NS):
                col = re.match(r'[A-Z]+', c.get('r')).group(0)
                v = c.find('m:v', NS)
                if v is None:
                    t = c.find('m:is/m:t', NS)
                    val = t.text if t is not None else None
                elif c.get('t') == 's':
                    val = shared[int(v.text)]
                else:
                    val = v.text
                cells[col] = val
            cols = sorted(cells, key=lambda k: (len(k), k))
            rows.append([cells[k] for k in cols])
        yield rows


def num(v):
    try: return round(float(str(v).replace(',', '')))
    except (TypeError, ValueError): return None


def rbi():
    """{state: {key: {year: value}}} for every year in each RBI table."""
    out = {}
    for key, (fname, _, _) in RBI_FILES.items():
        for rows in sheets(RBI_DIR / fname):
            head = next((r for r in rows if r and any(str(c or '').startswith('State/') for c in r)), None)
            if not head: continue
            i0 = next(i for i, c in enumerate(head) if str(c or '').startswith('State/'))
            years = head[i0 + 1:]
            for r in rows:
                if len(r) <= i0 or r is head: continue
                name = str(r[i0] or '').strip()
                if not name or name.startswith(('-', 'Note', 'Source')) or name[0].isdigit() or name.isupper(): continue
                if name == 'State/Union Territory': continue
                name = ALIAS.get(name, name)
                for y, v in zip(years, r[i0 + 1:]):
                    if y and num(v) is not None:
                        out.setdefault(name, {}).setdefault(key, {})[str(y).strip()] = num(v)
    return out


def get(url, tries=5):
    for i in range(tries):
        r = subprocess.run(['curl', '-sSf', '--max-time', '60', url], capture_output=True, text=True)
        if r.returncode == 0: return r.stdout
        time.sleep(2 ** i)
    sys.exit('failed: ' + url)


def mplads():
    """Sitting MPs' fund per state and house: allocated, spent, MPs counted."""
    rows, n = [], 1
    while True:
        d = json.loads(get(f'https://api.empoweredindian.in/api/summary/mps?limit=100&page={n}'))
        rows += d['data']
        if n >= d['pagination']['totalPages']: break
        n += 1
    out = {}
    for m in rows:
        st = ALIAS.get(m['state'].strip(), m['state'].strip())
        h = 'ls' if m['house'] == 'Lok Sabha' else 'rs'
        s = out.setdefault(st, {}).setdefault(h, {'mps': 0, 'allocated': 0, 'spent': 0})
        s['mps'] += 1
        s['allocated'] += round(m['allocatedAmount'] or 0)
        s['spent'] += round(m['totalExpenditure'] or 0)
    return out


def main():
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    states = rbi()
    actual = sorted({y for s in states.values() for k in s.values() for y in k if '(A)' in y})
    latest = actual[-1] if actual else None
    mp = old.get('mplads', {}).get('states', {}) if '--no-net' in sys.argv else mplads()
    sfar = json.loads((ROOT / 'tools/data/cag_sfar.json').read_text())
    out = {
        'checked': date.today().isoformat(),
        'unit': 'Rs crore unless marked rupees',
        'rbi': {
            'title': 'Handbook of Statistics on Indian States 2024-25, Reserve Bank of India',
            'page': RBI_PAGE, 'year': latest,
            'tables': {k: {'title': t, 'url': u} for k, (_, t, u) in RBI_FILES.items()},
            'states': {s: {k: v.get(latest) for k, v in d.items()} for s, d in sorted(states.items())
                       if s != 'All States and UTs' and latest and any(v.get(latest) is not None for v in d.values())},
            'all': {k: v.get(latest) for k, v in states.get('All States and UTs', {}).items()},
        },
        'mplads': {
            'title': 'MPLADS portal figures as published by Empowered Indian', 'page': 'https://empoweredindian.in/mplads',
            'unit': 'rupees', 'checked': date.today().isoformat() if '--no-net' not in sys.argv else old.get('mplads', {}).get('checked'),
            'states': dict(sorted(mp.items())),
        },
        'audit': sfar['states'],
        'missing': sfar['missing'],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(f"{OUT.relative_to(ROOT)}: RBI {latest}, {len(out['rbi']['states'])} states; MPLADS {len(mp)} states; "
          f"audit {len(sfar['states'])} states")


if __name__ == '__main__':
    main()
