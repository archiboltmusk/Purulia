#!/usr/bin/env python3
"""Each West Bengal MP's work in Parliament, for the report map's leader profiles (kasa.js openRepProfile). Needs places/wb_leaders.json (tools/build-wb-leaders.py).

    python3 tools/build-wb-record.py

- Lok Sabha work: PRS Legislative Research MP Track, 18th Lok Sabha (prsindia.org/mptrack). Each MP's page gives
  attendance, debates, questions and private member's bills, with the national and state averages and the period.
  Matched to seats by constituency name.
Writes places/wb_record.json.
"""
import difflib, html, json, re, subprocess, sys, time, unicodedata, urllib.parse
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRS = 'https://prsindia.org'
PRS_LIST = PRS + '/mptrack/18th-lok-sabha'
UA = 'Mozilla/5.0 (compatible; ParishkarBengal/1.0; +https://github.com/archiboltmusk/Purulia)'

def get(url, tries=4):
    for i in range(tries):
        r = subprocess.run(['curl', '-sSf', '--max-time', '60', '-A', UA, url], capture_output=True, text=True)
        if r.returncode == 0:
            time.sleep(1)  # one request a second: these are small public sites
            return r.stdout
        time.sleep(2 ** i)
    sys.exit('failed: ' + url)

def norm(s):
    s = unicodedata.normalize('NFKD', html.unescape(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\((sc|st)\)', '', s)
    return re.sub(r'[^a-z]', '', s)

def text(h):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()

def words(s):
    return re.findall(r'[a-z]{3,}', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())

def close(a, b, cut):
    return difflib.SequenceMatcher(None, a, b).ratio() >= cut

def same_person(a, b):
    # Spellings differ across sources ("Sougata Ray" / "Saugata Roy", "Adhikari Soumendu" / "Soumendu Adhikari"):
    # count words that nearly match, in any order; two such words (or all of a one-word name) is the same person.
    wa, wb = words(a), words(b)
    if close(''.join(wa), ''.join(wb), .85): return True  # "Kamala Kanta" / "Kamalakanta"
    hits = sum(any(close(x, y, .75) for y in wb) for x in wa)
    return hits >= min(2, len(wa), len(wb)) and hits > 0

def seat_of(name, by_seat):
    # Seat spellings differ too ("Srerampur" / "Sreerampur", "Bangaon" / "Bongaon").
    k = norm(name)
    if k in by_seat: return by_seat[k]
    best = difflib.get_close_matches(k, list(by_seat), n=1, cutoff=.8)
    return by_seat[best[0]] if best else None

def num(s):
    m = re.search(r'[\d.]+', s or '')
    return float(m.group()) if m else None

def prs_mps():
    links, page = [], 1
    while True:
        q = urllib.parse.urlencode({'MpTrackSearch[state]': 'West Bengal', 'page': page, 'per-page': 9})
        h = get(f'{PRS_LIST}?{q}')
        found = [l for l in dict.fromkeys(re.findall(r'href="(/mptrack/18th-lok-sabha/[^"?#]+)"', h)) if l not in links]
        if not found: return links
        links += found
        page += 1

def prs_record(path):
    t = text(get(PRS + path))
    seat = re.search(r'Constituency : (.+?) Party :', t)
    name = re.search(r'Data corresponds to the period from [\d-]+ to [\d-]+\. (.+?) State :', t)
    period = re.search(r'period from ([\d-]+) to ([\d-]+)', t)
    def trio(label):
        m = re.search(label + r' Selected MP ([\d.]+) ?%? National Average ([\d.]+) ?%? State Average ([\d.]+)', t)
        return [int(float(x)) if float(x).is_integer() else float(x) for x in m.groups()] if m else [None, None, None]
    att, deb, que, pmb = trio('Attendance'), trio('No. of Debates'), trio('No. of Questions'), trio("Private Member's Bills")
    if not seat or not name: return None
    iso = lambda d: '-'.join(reversed(d.split('-')))
    return {'seat': seat.group(1).strip(), 'name': name.group(1).strip(), 'url': PRS + path,
            'from': iso(period.group(1)) if period else None, 'to': iso(period.group(2)) if period else None,
            'attendance': att[0], 'debates': deb[0], 'questions': que[0], 'bills': pmb[0],
            'avg': {'national': {'attendance': att[1], 'debates': deb[1], 'questions': que[1], 'bills': pmb[1]},
                    'state': {'attendance': att[2], 'debates': deb[2], 'questions': que[2], 'bills': pmb[2]}}}

def main():
    leaders = json.loads((ROOT / 'places/wb_leaders.json').read_text())
    out = {'checked': date.today().isoformat(),
           'sources': {'prs': PRS_LIST}, 'pc': {}, 'avg': None, 'missing': {'prs': []}}
    by_seat = {norm(v['name']): n for n, v in leaders['pc'].items()}
    for path in prs_mps():
        r = prs_record(path)
        n = r and seat_of(r['seat'], by_seat)
        if not n or not same_person(r['name'], leaders['pc'][n].get('person', '')): continue
        if r['avg']['national']['attendance'] is not None and not out['avg']:
            out['avg'] = {'national': r['avg']['national'], 'state': r['avg']['state'], 'from': r['from'], 'to': r['to']}
        out['pc'].setdefault(n, {})['prs'] = {k: r[k] for k in ('url', 'attendance', 'debates', 'questions', 'bills')}
    out['missing']['prs'] = [v['name'] for n, v in leaders['pc'].items() if not v.get('vacant') and 'prs' not in out['pc'].get(n, {})]
    (ROOT / 'places/wb_record.json').write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + '\n')
    print(f"PRS {len(out['pc'])} MPs; missing {json.dumps(out['missing'])}")

if __name__ == '__main__':
    main()
