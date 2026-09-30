#!/usr/bin/env python3
"""West Bengal ministers and every West Bengal MP's local area fund, for the report map's
leader profiles (kasa.js openRepProfile). Needs places/wb_leaders.json (tools/build-wb-leaders.py).

    python3 tools/build-wb-reps.py

- Ministers and portfolios: "Council of Ministers" table of the Wikipedia article
  "Suvendu Adhikari ministry" (itself citing the state's portfolio notices). Each minister is
  matched to their assembly seat by name in wb_leaders.json; no match leaves the seat out.
- MPLADS: official MPLADS portal figures as published by Empowered Indian
  (api.empoweredindian.in): summary per MP, plus every work recommended this term (with the amount paid so far) and every work completed.
  Lok Sabha MPs are matched to seats by constituency name; a vacant seat gets no figures.
Writes places/wb_ministers.json, places/wb_mplads.json and places/mplads/<id>.json (works lists).
"""
import json, re, subprocess, sys, time, unicodedata, urllib.parse
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = 'https://api.empoweredindian.in/api'
SITE = 'https://empoweredindian.in/mplads/mps/'
MIN_PAGE = 'Suvendu Adhikari ministry'
# Empowered Indian constituency name -> wb_leaders.json name, where they differ.
PC_ALIAS = {'COOCHBEHAR': 'Cooch Behar', 'ARAMBAG': 'Arambagh', 'BANGAON': 'Bongaon', 'BARRACKPUR': 'Barrackpore',
            'BARDHAMAN-DURGAPUR': 'Bardhaman–Durgapur', 'HOOGHLY': 'Hooghly'}

def get(url, tries=5):
    for i in range(tries):
        r = subprocess.run(['curl', '-sSf', '--max-time', '60', url], capture_output=True, text=True)
        if r.returncode == 0: return r.stdout
        time.sleep(2 ** i)
    sys.exit('failed: ' + url)

def pages(url, key):  # the API serves at most 100 rows a page
    out, n = [], 1
    while True:
        d = json.loads(get(f'{url}&page={n}'))['data']
        out += d[key]
        if not d['pagination'].get('hasNext'): return out
        n += 1

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z]', '', s)

def slug(s):
    return re.sub(r'-{2,}', '-', re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', s.lower()).replace('&', ' and ')).strip('-'))

def mp_url(m):
    # Same slug the site builds: name-constituency-state-<term>-lok-sabha, "rajya sabha" moved to the end.
    parts = slug(f"{m['mpName']} {m['constituency']} {m['state']}").split('-')
    if m['house'] == 'Lok Sabha': return SITE + '-'.join(parts + ['18th', 'lok', 'sabha'])
    out = [p for i, p in enumerate(parts) if not (p == 'rajya' and parts[i + 1:i + 2] == ['sabha']) and not (p == 'sabha' and parts[i - 1:i] == ['rajya'])]
    return SITE + '-'.join(out + ['rajya', 'sabha'])

def clean_name(s):
    s = re.sub(r'\s*\(\d{4}-\d{2}\)\s*$', '', s.strip())
    s = re.sub(r'^(Shri|Smt\.?|Ms\.?|Mr\.?|Dr\.?|Prof\.?)\s+', '', s, flags=re.I).strip()
    return s.title() if s.isupper() else s

leaders = json.load(open(ROOT / 'places' / 'wb_leaders.json'))

# ── MPLADS ──
mps = [m for m in json.loads(get(API + '/summary/mps?page=1&limit=1000'))['data'] if m['state'] == 'West Bengal']
pc_by_name = {norm(v['name']): k for k, v in leaders['pc'].items()}
works_dir = ROOT / 'places' / 'mplads'
works_dir.mkdir(exist_ok=True)
out_pc, out_rs = {}, []
for m in sorted(mps, key=lambda m: (m['house'], m['mpName'])):
    ls = m['house'] == 'Lok Sabha'
    if ls:
        no = pc_by_name.get(norm(PC_ALIAS.get(m['constituency'], m['constituency'])))
        if not no: sys.exit('no seat for ' + m['constituency'])
        if leaders['pc'][no].get('vacant'): continue
        wid = 'pc-' + no
    else:
        wid = 'rs-' + slug(clean_name(m['mpName']))
    q = urllib.parse.urlencode({'state': 'West Bengal', 'constituency': m['constituency'], 'house': m['house'], 'limit': 100,
                                **({'ls_term': 18} if ls else {})})
    done, rec = pages(f'{API}/works/completed?{q}', 'completedWorks'), pages(f'{API}/works/recommended?{q}', 'recommendedWorks')
    mine = lambda w: w['mp_details']['name'].strip() == m['mpName'].strip()
    loc = lambda w: re.sub(r'\s*\(.*$', '', w.get('location') or '').title()
    works = {'completed': [{'w': w['work_description'].strip(), 'rs': round(w['cost']), 'on': (w.get('completion_date') or '')[:10], 'at': loc(w)}
                           for w in sorted(filter(mine, done), key=lambda w: w.get('completion_date') or '', reverse=True)],
             'recommended': [{'w': w['work_description'].strip(), 'rs': round(w['estimated_cost']), 'on': (w.get('recommended_date') or '')[:10],
                              'paid': round(w.get('totalPaid') or 0), 'at': loc(w)}
                             for w in sorted(filter(mine, rec), key=lambda w: w.get('recommended_date') or '', reverse=True)]}
    json.dump(works, open(works_dir / f'{wid}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    row = {'works': wid, 'allocated': round(m['allocatedAmount']), 'recommended': round(m['totalRecommendedAmount']),
           'spent': round(m['totalExpenditure']), 'worksRecommended': m['recommendedWorksCount'],
           'worksCompleted': m['completedWorksCount'], 'url': mp_url(m)}
    if ls: out_pc[no] = row
    else:
        term = re.search(r'\((\d{4})-(\d{2})\)', m['mpName'])
        out_rs.append({'name': clean_name(m['mpName']), 'term': term and f'{term.group(1)}–20{term.group(2)}',
                       'nominated': m['constituency'].lower().startswith('nominated'), **row})
json.dump({'checked': date.today().isoformat(), 'source': 'https://empoweredindian.in/mplads',
           'pc': dict(sorted(out_pc.items(), key=lambda x: int(x[0]))), 'rs': out_rs},
          open(ROOT / 'places' / 'wb_mplads.json', 'w'), ensure_ascii=False, indent=0)

# ── Ministers ──
raw = get('https://en.wikipedia.org/w/index.php?action=raw&title=' + urllib.parse.quote(MIN_PAGE.replace(' ', '_')))
table = raw[raw.index('== Council of Ministers =='):]
table = table[:table.index('\n|}')]
ac_by_name = {norm(v['person']): k for k, v in leaders['ac'].items()}
ministers, rank, ports = [], 'cm', []
for line in table.split('\n'):
    s = line.strip()
    h = re.match(r'^!.*\|(Cabinet Ministers|Ministers of State \(Independent Charge\)|Ministers of State)\]\]', s)
    if h:
        rank = {'Cabinet Ministers': 'cabinet', 'Ministers of State (Independent Charge)': 'mos_ic', 'Ministers of State': 'mos'}[h.group(1)]
        continue
    if s.startswith('|-'): ports = []; continue
    if s.startswith('*'):
        p = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r'\1', s.lstrip('* ')).strip().rstrip(',')
        ports.append(re.sub(r'AffairsC$', 'Affairs', p))
        continue
    n = re.search(r"'''\[\[(?:[^\]|]+\|)?([^\]]+)\]\]'''|\[\[[^\]|]+\|'''([^']+)'''\]\]", s)
    if n and ports:
        name = (n.group(1) or n.group(2)).strip()
        ac = ac_by_name.get(norm(name))
        ministers.append({'name': name, 'rank': rank, 'portfolios': ports, **({'ac': int(ac)} if ac else {})})
        ports = []
json.dump({'checked': date.today().isoformat(), 'source': 'https://en.wikipedia.org/wiki/' + MIN_PAGE.replace(' ', '_'),
           'ministers': ministers}, open(ROOT / 'places' / 'wb_ministers.json', 'w'), ensure_ascii=False, indent=0)
print(len(out_pc), 'Lok Sabha +', len(out_rs), 'Rajya Sabha MPs;', len(ministers), 'ministers,',
      sum('ac' in m for m in ministers), 'matched to a seat')
