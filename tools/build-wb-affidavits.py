#!/usr/bin/env python3
"""Sworn election affidavits of every West Bengal MLA and MP, for the report map's leader
profiles (kasa.js openRepProfile). Needs places/wb_leaders.json (tools/build-wb-leaders.py).

    python3 tools/build-wb-affidavits.py

Source: MyNeta (myneta.info), the Association for Democratic Reforms' digest of the
affidavits candidates file with the Election Commission of India.
- West Bengal 2026 assembly winners and Lok Sabha 2024 winners (West Bengal seats only):
  criminal cases declared, education, total assets and liabilities (₹), candidate page.
- "Winners with declared serious criminal cases" (ADR's own list): a yes/no flag, no count.
- "Asset comparison for re-contest winners": total assets in the previous affidavit and
  which election it was filed for. Only seats ADR lists get it; nothing is estimated.
Seats are matched to wb_leaders.json by constituency name; unmatched names are printed and
counted in "gaps". Some MyNeta rows are written by obfuscated scripts; they are decoded here.
Writes places/wb_affidavits.json.
"""
import difflib, html, json, re, sys, time, unicodedata, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'places' / 'wb_affidavits.json'
SITE = 'https://myneta.info'
ELECTIONS = {'ac': 'WestBengal2026', 'pc': 'LokSabha2024'}
UA = {'User-Agent': 'Mozilla/5.0 (compatible; parishkar-bengal data refresh; +https://github.com)'}
# MyNeta constituency name -> wb_leaders.json name, where spelling differs beyond case/punctuation.
ALIAS = {'ac': {'ARAMBAG': 'Arambagh', 'BAGDA': 'Bagdah', 'DABGRAM-FULBARI': 'Dabgram-Phulbari', 'HARISCHANDRAPUR': 'Harishchandrapur',
                'INDUS': 'Indas', 'JOYNAGAR': 'Jaynagar', 'LABHPUR': 'Labpur', 'MAHISHADAL': 'Mahisadal', 'MONGALKOTE': 'Mangalkot',
                'NOWDA': 'Naoda', 'TOLLYGANJ': 'Tollygunge'},
         'pc': {'ARAMBAG': 'Arambagh', 'BANGAON': 'Bongaon', 'BARRACKPUR': 'Barrackpore', 'JAYNAGAR': 'Joynagar',
                'BURDWAN - DURGAPUR': 'Bardhaman–Durgapur'}}


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                body = r.read().decode('utf-8', 'replace')
            time.sleep(0.5)  # be polite to myneta.info
            return body
        except OSError as e:
            print(f'retry {i + 1}: {url} ({e})', file=sys.stderr)
            time.sleep(2 ** i)
    sys.exit('failed: ' + url)


# ── MyNeta writes some table rows with eval(function(h,u,n,t,e,r){...}("...",u,"n",t,e,r)) ──
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


def page(url):
    """A MyNeta listing with its packed rows decoded, every page of it (they link page=2, 3, ...)."""
    doc = PACKED.sub(unpack, get(url))
    last = max([int(n) for n in re.findall(r'[?&]page=(\d+)', doc)] or [1])
    for n in range(2, last + 1): doc += PACKED.sub(unpack, get(f'{url}&page={n}'))
    return doc


def text(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def rupees(cell):
    m = re.search(r'(?:Rs\s*)?([\d,]+)', text(cell).replace('\xa0', ' '))
    return int(m.group(1).replace(',', '')) if m else None


def norm(s):
    s = re.sub(r'\((sc|st)\)', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())
    return re.sub(r'[^a-z]', '', s)


def rows(doc):
    return [re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S) for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', doc, re.S)]


def winners(folder):
    """Every winner of an election: {candidate_id: {...}}."""
    out = {}
    for td in rows(page(f'{SITE}/{folder}/index.php?action=show_winners&sort=default')):
        if len(td) < 8: continue
        cid = re.search(r'candidate_id=(\d+)', td[1])
        if not cid: continue
        crim = re.search(r'\d+', text(td[4]))
        out[cid.group(1)] = {'person': text(td[1]), 'seat': text(td[2]), 'party': text(td[3]),
                             'cases': int(crim.group(0)) if crim else None, 'edu': text(td[5]) or None,
                             'assets': rupees(td[6]), 'liab': rupees(td[7]),
                             'url': f'{SITE}/{folder}/candidate.php?candidate_id={cid.group(1)}'}
    if not out: sys.exit(f'no winners read for {folder}')
    return out


def serious(folder):
    doc = page(f'{SITE}/{folder}/index.php?action=summary&subAction=winner_serious_crime&sort=candidate')
    return set(re.findall(r'candidate\.php\?candidate_id=(\d+)', doc))


def recontest(folder):
    """{candidate_id: (previous assets, previous election folder, comparison url)} for re-contest winners."""
    out = {}
    for td in rows(page(f'{SITE}/{folder}/index.php?action=recontestAssetsComparison')):
        if len(td) < 4: continue
        a = re.search(r"href=['\"]?([^ '\">]*affidavitComparison[^ '\">]*)", td[1])
        if not a: continue
        url = html.unescape(a.group(1))
        cid, prev = re.search(r'id1=(\d+)', url), re.search(r'myneta_folder2=(\w+)', url)
        if cid and prev and rupees(td[3]) is not None:
            out[cid.group(1)] = (rupees(td[3]), prev.group(1), url if url.startswith('http') else f'{SITE}/{folder}/{url}')
    return out


def election_name(folder):
    m = re.match(r'([A-Za-z]+?)(\d{4})$', folder)
    if not m: return folder
    words = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', m.group(1))
    return f'{words} {m.group(2)}'


leaders = json.load(open(ROOT / 'places' / 'wb_leaders.json'))
data = {'checked': date.today().isoformat(), 'elections': {k: election_name(f) for k, f in ELECTIONS.items()},
        'sources': {k: f'{SITE}/{f}/index.php?action=show_winners&sort=default' for k, f in ELECTIONS.items()}
                   | {k + '_serious': f'{SITE}/{f}/index.php?action=summary&subAction=winner_serious_crime&sort=candidate' for k, f in ELECTIONS.items()}
                   | {k + '_growth': f'{SITE}/{f}/index.php?action=recontestAssetsComparison' for k, f in ELECTIONS.items()},
        'ac': {}, 'pc': {}, 'gaps': {}}

for kind, folder in ELECTIONS.items():
    wins, ser, prev = winners(folder), serious(folder), recontest(folder)
    seats, names = {}, {}
    for n, v in leaders[kind].items():
        if not v.get('vacant'): seats.setdefault(norm(v['name']), []).append(n)
    for cid, w in wins.items():
        base = re.sub(r'\s*\((SC|ST)\)\s*$', '', w['seat'])
        names.setdefault(norm(ALIAS[kind].get(base, base)), []).append(cid)
    unmatched, matched, pairs = [], set(), []
    for key, cids in names.items():
        ns = seats.get(key)
        if not ns:
            # Lok Sabha winners are national; only West Bengal names should match.
            if kind == 'ac': unmatched += [wins[c]['seat'] for c in cids]
            continue
        if len(ns) == len(cids) == 1: pairs.append((ns[0], cids[0])); continue
        # Same seat name twice (two Bishnupurs): pair each seat with the winner of the same name.
        sim = lambda n, c: difflib.SequenceMatcher(None, norm(leaders[kind][n]['person']), norm(wins[c]['person'])).ratio()
        for n in ns:
            best = sorted(cids, key=lambda c: -sim(n, c))
            if sim(n, best[0]) >= 0.6 and (len(best) == 1 or sim(n, best[1]) < 0.6): pairs.append((n, best[0]))
            else: print(f'ambiguous {kind} seat {n} {leaders[kind][n]["name"]}: left out')
    for n, cid in pairs:
        w = wins[cid]
        if difflib.SequenceMatcher(None, norm(leaders[kind][n]['person']), norm(w['person'])).ratio() < 0.5:
            print(f'check {kind} {n}: wb_leaders has {leaders[kind][n]["person"]}, MyNeta winner {w["person"]}')
        rec = {'person': w['person'], 'party': w['party'], 'cases': w['cases'], 'edu': w['edu'],
               'assets': w['assets'], 'liab': w['liab'], 'url': w['url']}
        if cid in ser: rec['serious'] = True
        if cid in prev:
            rec['prevAssets'], f, rec['cmp'] = prev[cid]
            rec['prevElection'] = election_name(f)
        data[kind][n] = {k: v for k, v in rec.items() if v is not None}
        matched.add(n)
    missing = [f'{n} {v["name"]}' for n, v in leaders[kind].items() if n not in matched and not v.get('vacant')]
    for s in unmatched: print(f'unmatched {kind} name: {s}')
    for s in missing: print(f'no affidavit for {kind} seat {s}')
    data['gaps'][kind] = {'unmatchedNames': len(unmatched), 'seatsWithout': len(missing)}
    print(f'{kind}: {len(matched)} seats, {sum("prevAssets" in v for v in data[kind].values())} with asset growth, '
          f'{sum(bool(v.get("serious")) for v in data[kind].values())} with serious cases')

data['ac'] = dict(sorted(data['ac'].items(), key=lambda x: int(x[0])))
data['pc'] = dict(sorted(data['pc'].items(), key=lambda x: int(x[0])))
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
print('wrote', OUT.relative_to(ROOT))
