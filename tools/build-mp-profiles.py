#!/usr/bin/env python3
"""Sourced profile of every Lok Sabha MP of one Indian state, for the MP page (mp.html).

    python3 tools/build-mp-profiles.py uttar-pradesh bihar

Writes places/mp/<state>.json. Per seat (Lok Sabha constituency):
- seat, MP, party, assembly seats and their MLAs: from places/in/<state>.geojson (set by build-in-map.py)
- MPLADS (empoweredindian.in, official MPLADS data via api.empoweredindian.in): allocated, recommended,
  spent, works completed and recommended with amounts and dates, for this term
- PRS Legislative Research (MP Track, 18th Lok Sabha): attendance, debates, questions, private bills,
  with the national and state averages and the period
- MyNeta / ADR: sworn affidavit of the 2024 election: assets, liabilities, criminal cases declared,
  serious-case flag (ADR's list), education, previous assets when ADR lists the re-contest comparison
A field with no matching source is null and listed in "gaps"; nothing is estimated.
Matching is by constituency name (accent and punctuation free); unmatched names are printed.
Cache: tools/data/.mp-cache (delete to refetch).
"""
import difflib, hashlib, html, http.client, json, re, sys, time, unicodedata, urllib.parse, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'data' / '.mp-cache'
OUT = ROOT / 'places' / 'mp'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; parishkar data refresh; +https://github.com/archiboltmusk/Purulia)'}
API = 'https://api.empoweredindian.in/api'
MPLADS_SITE = 'https://empoweredindian.in/mplads'
PRS = 'https://prsindia.org'
PRS_LIST = PRS + '/mptrack/18th-lok-sabha'
MYNETA = 'https://myneta.info'
MYNETA_LS = 'LokSabha2024'


def get(url, tries=4):
    """Cached GET; retries with backoff. Returns text."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + '.txt')
    if f.exists(): return f.read_text()
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                body = r.read().decode('utf-8', 'replace')
            f.write_text(body)
            time.sleep(0.3)
            return body
        except (OSError, http.client.HTTPException) as e:
            print(f'retry {i + 1}: {url} ({e})', file=sys.stderr)
            time.sleep(2 ** i)
    sys.exit('failed: ' + url)


def api_pages(url, key):
    """The MPLADS API serves at most 100 rows a page."""
    out, n = [], 1
    while True:
        d = json.loads(get(f'{url}&page={n}'))['data']
        out += d[key]
        if not d['pagination'].get('hasNext'): return out
        n += 1


# Lok Sabha seat name -> the spelling a source uses, where it differs beyond accents and punctuation.
MPLADS_ALIAS = {'Purnia': 'Purnea', 'Ujiarpur': 'Ujjarpur', 'Koderma': 'Kodarma', 'Mandsaur': 'Mandsour'}
SEAT_ALIAS = {'Koderma': 'Kodarma', 'Mandsaur': 'Mandsour'}  # PRS and MyNeta


def norm(s):
    s = re.sub(r'\((sc|st)\)', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower())
    return re.sub(r'[^a-z]', '', s)


def slug(s):
    return re.sub(r'-{2,}', '-', re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', s.lower()).replace('&', ' and ')).strip('-'))


def same(a, b, cut):
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= cut


def num(s):
    m = re.search(r'-?[\d.]+', s or '')
    return float(m.group()) if m else None


# ── seats ──
def seats_of(state):
    """{pc name: {mp, mp_party, assembly: [...], center}} from the state's outlines."""
    data = json.loads((ROOT / 'places' / 'in' / f'{state}.geojson').read_text())
    out, pts = {}, {}
    for f in data['features']:
        p = f['properties']
        if p.get('kind') != 'ac' or not p.get('pc'): continue
        s = out.setdefault(p['pc'], {'mp': p.get('mp'), 'mp_party': p.get('mp_party'), 'assembly': []})
        s['assembly'].append({'name': p.get('name'), 'mla': p.get('mla'), 'mla_party': p.get('mla_party')})
        for xy in _coords(f['geometry']['coordinates']):
            pts.setdefault(p['pc'], []).append(xy)
    for pc, s in out.items():
        xs, ys = zip(*pts[pc])
        s['center'] = [round((min(ys) + max(ys)) / 2, 4), round((min(xs) + max(xs)) / 2, 4)]
        s['assembly'].sort(key=lambda a: a['name'] or '')
    if not out:
        # No assembly outlines (union territories, some small states): one seat, from the state's index entry.
        info = json.loads((ROOT / 'places' / 'in' / 'index.json').read_text())['states'][state]
        x0, y0, x1, y1 = info['bbox'][0], info['bbox'][1], info['bbox'][2], info['bbox'][3]
        for row in info.get('mp') or []:
            out[row['name']] = {'mp': row['person'], 'mp_party': row['party'], 'assembly': [],
                                'center': [round((y0 + y1) / 2, 4), round((x0 + x1) / 2, 4)]}
    return out


def _coords(c):
    if c and isinstance(c[0], (int, float)): return [c]
    return [xy for part in c for xy in _coords(part)]


# ── MPLADS ──
def mplads(state_name):
    rows = json.loads(get(f'{API}/summary/mps?page=1&limit=1000'))['data']
    return [m for m in rows if m['state'] == state_name and m['house'] == 'Lok Sabha']


def mplads_works(m):
    q = urllib.parse.urlencode({'state': m['state'], 'constituency': m['constituency'], 'house': 'Lok Sabha', 'limit': 100, 'ls_term': 18})
    done = api_pages(f'{API}/works/completed?{q}', 'completedWorks')
    rec = api_pages(f'{API}/works/recommended?{q}', 'recommendedWorks')
    mine = lambda w: w['mp_details']['name'].strip() == m['mpName'].strip()
    loc = lambda w: re.sub(r'\s*\(.*$', '', w.get('location') or '').title()
    return {'completed': [{'w': w['work_description'].strip(), 'rs': round(w['cost']), 'on': (w.get('completion_date') or '')[:10], 'at': loc(w)}
                          for w in sorted(filter(mine, done), key=lambda w: w.get('completion_date') or '', reverse=True)],
            'recommended': [{'w': w['work_description'].strip(), 'rs': round(w['estimated_cost']), 'on': (w.get('recommended_date') or '')[:10],
                             'paid': round(w.get('totalPaid') or 0), 'at': loc(w)}
                            for w in sorted(filter(mine, rec), key=lambda w: w.get('recommended_date') or '', reverse=True)]}


# ── PRS ──
def prs_links(state_name):
    links, page = [], 1
    while True:
        h = get(f'{PRS_LIST}?' + urllib.parse.urlencode({'MpTrackSearch[state]': state_name, 'page': page, 'per-page': 9}))
        found = [l for l in dict.fromkeys(re.findall(r'href="(/mptrack/18th-lok-sabha/[^"?#]+)"', h)) if l not in links]
        if not found: return links
        links += found
        page += 1


def prs_text(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def prs_record(path):
    t = prs_text(get(PRS + path))
    seat = re.search(r'Constituency : (.+?) Party :', t)
    name = re.search(r'Data corresponds to the period from [\d-]+ to [\d-]+\. (.+?) State :', t)
    period = re.search(r'period from ([\d-]+) to ([\d-]+)', t)
    def trio(label):
        m = re.search(label + r' Selected MP ([\d.]+) ?%? National Average ([\d.]+) ?%? State Average ([\d.]+)', t)
        return [num(x) for x in m.groups()] if m else [None, None, None]
    att, deb, que, pmb = trio('Attendance'), trio('No. of Debates'), trio('No. of Questions'), trio("Private Member's Bills")
    if not seat or not name: return None
    iso = lambda d: '-'.join(reversed(d.split('-')))
    return {'seat': seat.group(1).strip(), 'name': name.group(1).strip(), 'url': PRS + path,
            'from': iso(period.group(1)) if period else None, 'to': iso(period.group(2)) if period else None,
            'attendance': att[0], 'debates': deb[0], 'questions': que[0], 'bills': pmb[0],
            'avg': {'national': {'attendance': att[1], 'debates': deb[1], 'questions': que[1], 'bills': pmb[1]},
                    'state': {'attendance': att[2], 'debates': deb[2], 'questions': que[2], 'bills': pmb[2]}}}


# ── MyNeta (ADR) ──
DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'
PACKED = re.compile(r'<script>[^<]*?eval\(function\(h,u,n,t,e,r\)\{.*?\}\("([^"]*)",(\d+),"([^"]*)",(\d+),(\d+),(\d+)\)\)\s*</script>', re.S)


def unpack(m):
    h, n, t, e = m.group(1), m.group(3), int(m.group(4)), int(m.group(5))
    out, i = [], 0
    while i < len(h):
        s = ''
        while h[i] != n[e]: s += h[i]; i += 1
        for j, c in enumerate(n): s = s.replace(c, str(j))
        out.append(chr(sum(DIGITS[:e].index(b) * e ** k for k, b in enumerate(reversed(s)) if b in DIGITS[:e]) - t))
        i += 1
    js = ''.join(out).encode('latin1').decode('utf-8', 'replace')
    w = re.match(r"\s*document\.write\('(.*)'\);?\s*$", js, re.S)
    return w.group(1).replace("\\'", "'") if w else ''


def myneta_page(url):
    doc = PACKED.sub(unpack, get(url))
    last = max([int(n) for n in re.findall(r'[?&]page=(\d+)', doc)] or [1])
    for n in range(2, last + 1): doc += PACKED.sub(unpack, get(f'{url}&page={n}'))
    return doc


def rupees(cell):
    m = re.search(r'(?:Rs\s*)?([\d,]+)', prs_text(cell).replace('\xa0', ' '))
    return int(m.group(1).replace(',', '')) if m else None


def myneta_rows(doc):
    return [re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S) for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', doc, re.S)]


def myneta_winners():
    out = {}
    for td in myneta_rows(myneta_page(f'{MYNETA}/{MYNETA_LS}/index.php?action=show_winners&sort=default')):
        if len(td) < 8: continue
        cid = re.search(r'candidate_id=(\d+)', td[1])
        if not cid: continue
        crim = re.search(r'\d+', prs_text(td[4]))
        out[cid.group(1)] = {'person': prs_text(td[1]), 'seat': prs_text(td[2]), 'party': prs_text(td[3]),
                             'cases': int(crim.group(0)) if crim else None, 'edu': prs_text(td[5]) or None,
                             'assets': rupees(td[6]), 'liab': rupees(td[7]),
                             'url': f'{MYNETA}/{MYNETA_LS}/candidate.php?candidate_id={cid.group(1)}'}
    if not out: sys.exit('no MyNeta winners read')
    return out


def myneta_serious():
    doc = myneta_page(f'{MYNETA}/{MYNETA_LS}/index.php?action=summary&subAction=winner_serious_crime&sort=candidate')
    return set(re.findall(r'candidate\.php\?candidate_id=(\d+)', doc))


def myneta_recontest():
    out = {}
    for td in myneta_rows(myneta_page(f'{MYNETA}/{MYNETA_LS}/index.php?action=recontestAssetsComparison')):
        if len(td) < 4: continue
        a = re.search(r"href=['\"]?([^ '\">]*affidavitComparison[^ '\">]*)", td[1])
        if not a: continue
        url = html.unescape(a.group(1))
        cid, prev = re.search(r'id1=(\d+)', url), re.search(r'myneta_folder2=(\w+)', url)
        if cid and prev and rupees(td[3]) is not None:
            out[cid.group(1)] = (rupees(td[3]), prev.group(1))
    return out


def build(state):
    name = json.loads((ROOT / 'places' / 'in' / 'index.json').read_text())['states'][state]['name']
    seats = seats_of(state)
    mp_rows = {m['constituency']: m for m in mplads(name)}
    prs_recs = {}
    for link in prs_links(name):
        r = prs_record(link)
        if r: prs_recs[r['seat']] = r
    wins, ser, prev = myneta_winners(), myneta_serious(), myneta_recontest()

    def find(table, seat_name, key):
        return next((k for k in table if key(k) == norm(seat_name)), None) or \
            next((k for k in table if same(key(k), seat_name, 0.9)), None)

    out, gaps = {}, {'mplads': [], 'prs': [], 'affidavit': []}
    for pc, s in sorted(seats.items()):
        key = slug(pc)
        rec = {'name': pc, 'center': s['center'], 'mp': {'name': s['mp'], 'party': s['mp_party']},
               'assembly': s['assembly'], 'mplads': None, 'works': None, 'prs': None, 'affidavit': None}
        m = find(mp_rows, MPLADS_ALIAS.get(pc, pc), norm)
        if m:
            row = mp_rows[m]
            rec['mplads'] = {'allocated': round(row['allocatedAmount']), 'recommended': round(row['totalRecommendedAmount']),
                             'spent': round(row['totalExpenditure']), 'worksRecommended': row['recommendedWorksCount'],
                             'worksCompleted': row['completedWorksCount'], 'mp': row['mpName']}
            rec['works'] = mplads_works(row)
        else: gaps['mplads'].append(pc)
        p = find(prs_recs, SEAT_ALIAS.get(pc, pc), norm)
        if p:  # PRS lists one MP per seat; its name can differ from Wikipedia's (e.g. a title or spelling)
            r = prs_recs[p]
            rec['prs'] = {k: r[k] for k in ('url', 'from', 'to', 'attendance', 'debates', 'questions', 'bills', 'avg')}
        else: gaps['prs'].append(pc)
        cids = [c for c, w in wins.items() if same(w['seat'], SEAT_ALIAS.get(pc, pc), 0.9)]
        if len(cids) > 1: cids = [c for c in cids if same(wins[c]['person'], s['mp'] or '', 0.5)]
        if len(cids) == 1:
            cid = cids[0]
            w = wins[cid]
            rec['affidavit'] = {k: v for k, v in {'person': w['person'], 'party': w['party'], 'cases': w['cases'], 'edu': w['edu'],
                                                  'assets': w['assets'], 'liab': w['liab'], 'url': w['url'],
                                                  'serious': True if cid in ser else None}.items() if v is not None}
            if cid in prev:
                rec['affidavit']['prevAssets'], rec['affidavit']['prevElection'] = prev[cid][0], prev[cid][1]
        else: gaps['affidavit'].append(pc)
        out[key] = rec
    data = {'state': name, 'slug': state, 'checked': date.today().isoformat(),
            'sources': {'seats': f'places/in/{state}.geojson', 'mplads': MPLADS_SITE, 'prs': PRS_LIST,
                        'affidavit': f'{MYNETA}/{MYNETA_LS}/index.php?action=show_winners&sort=default'},
            'counts': {'seats': len(seats), 'mplads': len(seats) - len(gaps['mplads']),
                       'prs': len(seats) - len(gaps['prs']), 'affidavit': len(seats) - len(gaps['affidavit'])},
            'gaps': gaps, 'seats': out}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'{state}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(state, json.dumps(data['counts']), 'gaps', {k: v[:5] for k, v in gaps.items()})


if __name__ == '__main__':
    for st in sys.argv[1:]: build(st)
