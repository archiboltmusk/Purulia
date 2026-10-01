#!/usr/bin/env python3
"""Ward councillors of every West Bengal town on the map, from the State Election Commission.

    python3 tools/build-wb-councillors.py

Source: portal.wbme.org, the West Bengal State Election Commission's municipal results portal
(the same JSON its result pages read). For each town in places/wb_towns.geojson it reads every
result date (the 2022 general election, then any by-election), and per ward keeps the candidate
with the most votes; a later by-election replaces the ward's earlier winner. A ward whose top two
candidates tie, or that has no counted votes and more than one candidate, is left out.
Only name, party and result date are kept (the portal also lists addresses; we don't copy them).

Writes places/councillors/<slug>.json, the same shape as places/kolkata_councillors.json, which
kasa.js reads for the ward card and the ward list. Boards later dissolved (Wikipedia, cited) get
a `board` note so the card does not present them as sitting councillors.
"""
import json, re, sys, time, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'places/councillors'
API = 'https://portal.wbme.org/Index.aspx/'
UA = {'User-Agent': 'ParishkarBengal/1.0 (civic map; https://github.com/archiboltmusk/Purulia)', 'Content-Type': 'application/json'}

PARTY = {'AITC': 'Trinamool Congress', 'BJP': 'BJP', 'CPI(M)': 'CPI(M)', 'CPIM': 'CPI(M)', 'INC': 'Congress',
         'CPI': 'CPI', 'AIFB': 'Forward Bloc', 'RSP': 'RSP', 'IND': 'Independent', 'CPI(ML)L': 'CPI(ML) Liberation'}
# SEC portal name -> our town body, where they differ beyond spelling/punctuation.
ALIAS = {}
# Boards dissolved after the 2022 election (cited); the card then says so.
BOARD = {
    'bidhannagar': {'dissolved': 'June 2026',
                    'sourceUrl': 'https://en.wikipedia.org/wiki/Bidhannagar_Municipal_Corporation'},
    'nabadwip': {'dissolved': 'July 2026',
                 'sourceUrl': 'https://en.wikipedia.org/wiki/Nabadwip_Municipality'},
}
SMALL = {'of', 'and', 'ud', 'md', 'sk', 'kr', 'dr'}


CACHE = Path(__file__).resolve().parent / 'data/.wbme-cache'


def call(method, body):
    """POST to the portal; responses cached under tools/data/.wbme-cache (git-ignored) so a rerun resumes."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (method + '-' + re.sub(r'\W+', '_', json.dumps(body, sort_keys=True)) + '.json')
    if key.exists(): return json.loads(key.read_text())
    req = urllib.request.Request(API + method, json.dumps(body).encode(), UA)
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                key.write_text(json.load(r)['d'])
                return json.loads(key.read_text())
        except Exception as e:
            if i == 4: raise
            print(' retry', method, e, file=sys.stderr, flush=True); time.sleep(3 * 2 ** i)


def norm(s):
    s = s.upper().replace('–', '-')
    s = re.sub(r'\b(MUNICIPAL CORPORATION|MUNICIPALITY|CORPORATION)\b', '', s)
    return re.sub(r'[^A-Z]', '', s)


def title(name):
    name = re.sub(r'\s+', ' ', name.strip())
    out = []
    for w in name.split(' '):
        lw = w.lower()
        if '.' in w and len(w) <= 4: out.append(w.capitalize())       # MD., KR.
        else: out.append('-'.join(p[:1].upper() + p[1:] for p in lw.split('-')))
    return ' '.join(out)


def winners(muni_id):
    """{ward: {councillor, party, date, unopposed?}} over every result date, by-elections last."""
    dates = call('SelectMunicipalityWisePollResultDate', {'MunicipalityDirectoryID': muni_id})
    dates.sort(key=lambda d: tuple(reversed(d['PollResultDate'].split('/'))))
    wards = {}
    for d in dates:
        rows = call('SelectCandidateVotesinFavourPortalList',
                    {'MunicipalityDirectoryID': str(muni_id), 'MunicipalitySeatID': '0', 'PanchayatPollDateID': str(d['ID'])})
        by = {}
        for r in rows:
            m = re.match(r'WARD-(\d+)$', (r.get('SeatName') or '').strip().upper())
            if m: by.setdefault(int(m.group(1)), []).append(r)
        when = '-'.join(reversed(d['PollResultDate'].split('/')))
        for n, cands in by.items():
            cands.sort(key=lambda r: -(r.get('VoteInFavour') or 0))
            top = cands[0]
            if len(cands) > 1 and (top.get('VoteInFavour') or 0) == (cands[1].get('VoteInFavour') or 0): continue
            p = (top.get('PartyAffiliation') or '').strip().upper()
            w = {'councillor': title(top['CandidateName']), 'party': PARTY.get(p, p or None), 'result': when}
            if len(cands) == 1: w['unopposed'] = True
            wards[n] = w
        time.sleep(0.5)
    return dates, wards


def main():
    towns = [f['properties'] for f in json.load(open(ROOT / 'places/wb_towns.geojson'))['features']]
    munis = {}
    for z in call('PopulateDistrictWiseMunicipality', {}):
        for s in z['SubDivisions']:
            for m in s['Municipalities']:
                munis[norm(ALIAS.get(m['Name'], m['Name']))] = m
    OUT.mkdir(exist_ok=True)
    today = date.today().isoformat()
    missing = []
    for t in towns:
        m = munis.get(norm(t['body'])) or munis.get(norm(t['name']))
        if not m: missing.append(t['body']); continue
        dates, wards = winners(m['ID'])
        if not wards: missing.append(t['body'] + ' (no results)'); continue
        first = min(w['result'] for w in wards.values())
        for w in wards.values():
            if w['result'] != first: w['elected'] = date.fromisoformat(w['result']).strftime('%B %Y') + ' (by-election)'
        j = {'source': f"West Bengal State Election Commission, municipal election results: {m['Name'].title()}",
             'sourceUrl': 'https://portal.wbme.org/', 'checked': today,
             'elected': date.fromisoformat(first).strftime('%B %Y'),
             'note': 'Winner per ward = most votes in the SEC result; a by-election replaces the earlier winner.',
             'wards': {str(n): wards[n] for n in sorted(wards)}}
        if t['slug'] in BOARD: j['board'] = BOARD[t['slug']]
        (OUT / f"{t['slug']}.json").write_text(json.dumps(j, ensure_ascii=False, separators=(',', ':')) + '\n')
        print(t['slug'], len(wards), 'of', t.get('wards'), file=sys.stderr, flush=True)
    print('no SEC results:', ', '.join(missing), file=sys.stderr)


if __name__ == '__main__':
    main()
