#!/usr/bin/env python3
"""States, districts, assembly seats, MLAs and MPs for all of India outside West Bengal,
for the report map (West Bengal has its own, more detailed files: places/wb*).

    python3 -m pip install geopandas pyarrow pandas lxml html5lib
    python3 tools/build-in-map.py

Boundaries (Local Government Directory, CC0, via github.com/yashveeeeeeer/india-geodata releases):
- LGD_States.parquet, LGD_Districts.parquet, LGD_Assembly_Constituencies.parquet
  (each assembly seat carries its Lok Sabha seat number and name).
Representatives (Wikipedia, CC BY-SA, read as rendered HTML):
- MLAs: the current-members table of "<State> Legislative Assembly" (follows by-elections).
- MPs: "List of members of the 18th Lok Sabha", one table per state.
A seat's MLA or MP is attached only when the seat's name in the boundary file matches
the name on Wikipedia (number first, else name); everything that does not match is
counted in places/in/index.json, so gaps are visible rather than guessed.
Jammu and Kashmir: the boundary file has the seats from before the 2022 delimitation,
so no seat outlines and no names are attached there; the card links the member lists.

Writes places/in_states.geojson (all states, about 1 km), places/in/<state>.geojson
(districts + assembly seats, about 200 m, loaded only when that state is in view) and
places/in/index.json.
"""
import io, json, re, subprocess, sys, unicodedata, urllib.parse
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
import geopandas as gpd, pandas as pd
from shapely.geometry import mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'places' / 'in'
CACHE = ROOT / 'tools' / 'data' / '.in-cache'
REL = 'https://github.com/yashveeeeeeer/india-geodata/releases/download/'
FILES = {'states': 'admin/states/LGD_States.parquet', 'districts': 'admin/districts/LGD_Districts.parquet',
         'acs': 'electoral/constituencies/LGD_Assembly_Constituencies.parquet'}
WIKI = 'https://en.wikipedia.org/wiki/'
LS_PAGE = 'List of members of the 18th Lok Sabha'
TOL_STATE, TOL = 0.01, 0.002        # degrees: about 1 km, about 200 m
SKIP = {19}                          # West Bengal (places/wb*)
NO_SEAT_MAP = {1: 'The boundary file has the seats from before the 2022 delimitation.',
               18: 'The boundary file has the seats from before the 2023 delimitation.'}
NO_ASSEMBLY = {4, 31, 35, 37, 38}    # Union territories without a legislature: an MP only
# State as Wikipedia names it (its assembly article and its Lok Sabha table heading).
WNAME = {1: 'Jammu and Kashmir', 35: 'Andaman and Nicobar Islands', 38: 'Dadra and Nagar Haveli and Daman and Diu',
         33: 'Tamil Nadu', 21: 'Odisha'}
# Seats by state in the boundary file, where its codes differ from the state's own.
AC_STATE = {28: 28, 36: 36}
PARTY = {'Bharatiya Janata Party': 'BJP', 'Indian National Congress': 'INC', 'Samajwadi Party': 'SP',
         'All India Trinamool Congress': 'AITC', 'Aam Aadmi Party': 'AAP', 'Dravida Munnetra Kazhagam': 'DMK',
         'All India Anna Dravida Munnetra Kazhagam': 'AIADMK', 'Telugu Desam Party': 'TDP', 'Janata Dal (United)': 'JD(U)',
         'Rashtriya Janata Dal': 'RJD', 'Communist Party of India (Marxist)': 'CPI(M)', 'Communist Party of India': 'CPI',
         'Shiv Sena': 'SS', 'Shiv Sena (Uddhav Balasaheb Thackeray)': 'SS(UBT)', 'Nationalist Congress Party': 'NCP',
         'Nationalist Congress Party – Sharadchandra Pawar': 'NCP(SP)', 'Nationalist Congress Party (Sharadchandra Pawar)': 'NCP(SP)',
         'YSR Congress Party': 'YSRCP', 'Yuvajana Sramika Rythu Congress Party': 'YSRCP', 'Bharat Rashtra Samithi': 'BRS',
         'Biju Janata Dal': 'BJD', 'Jharkhand Mukti Morcha': 'JMM', 'Bahujan Samaj Party': 'BSP', 'Janata Dal (Secular)': 'JD(S)',
         'Indian Union Muslim League': 'IUML', 'Lok Janshakti Party (Ram Vilas)': 'LJP(RV)', 'Rashtriya Lok Dal': 'RLD',
         'Jammu & Kashmir National Conference': 'JKNC', 'Jammu and Kashmir National Conference': 'JKNC',
         'Shiromani Akali Dal': 'SAD', 'Sikkim Krantikari Morcha': 'SKM', 'National People\'s Party': 'NPP',
         'Nationalist Democratic Progressive Party': 'NDPP', 'Mizo National Front': 'MNF', 'Zoram People\'s Movement': 'ZPM',
         'Asom Gana Parishad': 'AGP', 'All India United Democratic Front': 'AIUDF', 'Tamilaga Vettri Kazhagam': 'TVK',
         'All India N.R. Congress': 'AINRC', 'Jana Sena Party': 'JSP', 'Janasena Party': 'JSP', 'Independent': 'IND', 'Independent politician': 'IND',
         'All India Majlis-e-Ittehadul Muslimeen': 'AIMIM', 'Revolutionary Socialist Party': 'RSP',
         'Kerala Congress (M)': 'KC(M)', 'Viduthalai Chiruthaigal Katchi': 'VCK', 'Pattali Makkal Katchi': 'PMK',
         'Communist Party of India (Marxist–Leninist) Liberation': 'CPI(ML)L', 'Hindustani Awam Morcha': 'HAM(S)',
         'Rashtriya Lok Morcha': 'RLM', 'Apna Dal (Sonelal)': 'AD(S)', 'Suheldev Bharatiya Samaj Party': 'SBSP',
         'Nishad Party': 'NISHAD', 'Indian National Lok Dal': 'INLD', 'Tipra Motha Party': 'TMP', 'United Democratic Party': 'UDP',
         'Naga People\'s Front': 'NPF', 'Voice of the People Party': 'VPP', 'Bodoland People\'s Front': 'BPF',
         'United People\'s Party Liberal': 'UPPL', 'Jammu and Kashmir Peoples Democratic Party': 'JKPDP',
         'Vikassheel Insaan Party': 'VIP', 'Azad Samaj Party (Kanshi Ram)': 'ASP(KR)', 'Rashtriya Loktantrik Party': 'RLP',
         'Bharat Adivasi Party': 'BAP', 'Zoram Nationalist Party': 'ZNP', 'Marumalarchi Dravida Munnetra Kazhagam': 'MDMK'}

def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower().replace('&', 'and')).strip('-')
def title(s): return ' '.join(w if w.isupper() and len(w) <= 3 and w not in ('AND',) else w.capitalize() for w in re.split(r'\s+', s.strip())).replace(' And ', ' and ').replace(' Of ', ' of ')
def rnd(c): return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\[[^\]]*\]|\((sc|st|gen|general)\)|\b(sc|st)\b', ' ', s).replace('pondicherry', 'puducherry')
    return re.sub(r'[^a-z]', '', s)
def same(a, b): return norm(a) == norm(b) or SequenceMatcher(None, norm(a), norm(b)).ratio() >= .8
def reserved(name):
    m = re.search(r'\((sc|st)\)', name, re.I)
    return m and m.group(1).upper()
def by_name(rows, name, fuzzy=False, used=()):
    """The one row with exactly this name; none when two seats share it (Gannavaram and Gannavaram (SC)).
    Lok Sabha seats, far fewer and with distinct names, may also match on a near spelling."""
    rows = [x for x in rows if id(x) not in used]
    hit = [x for x in rows if norm(x['seat']) == norm(name)]
    if not hit and fuzzy: hit = [x for x in rows if same(x['seat'], name)]
    if len(hit) > 1: hit = [x for x in hit if x.get('res') == reserved(name)]
    return hit[0] if len(hit) == 1 else None
def clean(s): return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', '', str(s))).strip()

def fetch(url, name):
    f = CACHE / name
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sSfL', '-A', 'ParishkarBengal-builder/1.0', '-o', str(f), url], check=True)
    return f

def wiki(page):
    return fetch(f'https://en.wikipedia.org/w/index.php?title={urllib.parse.quote(page.replace(" ", "_"))}&action=render',
                 'w-' + slug(page) + '.html').read_text()

def outline(geoms, tol):
    g = unary_union([x.buffer(0) for x in geoms]).simplify(tol, preserve_topology=True)
    polys = [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
    big = max(p.area for p in polys)
    polys = [p for p in polys if p.area >= big * 1e-4 or p.area > tol * tol * 4]
    geom = mapping(polys[0]) if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': [mapping(p)['coordinates'] for p in polys]}
    geom['coordinates'] = rnd(geom['coordinates'])
    b = unary_union(polys).bounds
    return geom, [round(x, 4) for x in b]

def party(s):
    s = clean(s)
    return PARTY.get(s, s)

def cols(t):
    return [' / '.join(dict.fromkeys(clean(x) for x in (c if isinstance(c, tuple) else (c,)))).lower() for c in t.columns]

def members(html, n_hint):
    """Rows (no, seat, person, party) of the current-members table: the one with a seat number or name,
    a member name and a party, and about as many rows as the state has seats."""
    best = None
    for t in pd.read_html(io.StringIO(html)):
        c = cols(t)
        last = [x.split(' / ')[-1] for x in c]
        no = next((i for i, x in enumerate(last) if re.fullmatch(r'(no\.?|#|ac\.? no\.?|number|constituency number)', x)), None)
        seat = next((i for i, x in enumerate(c) if 'constituency' in x and i != no and not re.search(r'\bno\b|#|lok sabha|reserv|electorate', x)), None)
        who = next((i for i, x in enumerate(c) if i not in (no, seat) and re.search(r'(^|/ )(name|member|elected member|mla)( \[\d+\])?$', x)
                    and 'constituency' not in x and 'party' not in x), None)
        pts = [i for i, x in enumerate(last) if re.match(r'(political )?party', x)]
        rsv = next((i for i, x in enumerate(c) if 'reserv' in x), None)
        if seat is None or who is None or not pts: continue
        rows = len(t)
        if best and abs(best[0] - n_hint) <= abs(rows - n_hint): continue
        pt = max(pts, key=lambda i: (t.iloc[:, i].notna().sum(), i))
        out = []
        for _, r in t.iterrows():
            num = pd.to_numeric(str(r.iloc[no]).split('.')[0] if no is not None else '', errors='coerce')
            # "Yogi Adityanath (Chief Minister)": the name only.
            person, name = re.sub(r'\s*\([^)]*\)\s*$', '', clean(r.iloc[who])), clean(r.iloc[seat])
            if not name or name.lower() == 'nan' or not person or person.lower() == 'nan': continue
            vac = person.lower().startswith('vacant')
            res = re.search(r'\b(SC|ST)\b', name + ' ' + (str(r.iloc[rsv]) if rsv is not None else ''))
            out.append({'no': None if pd.isna(num) else int(num), 'seat': re.sub(r'\s*\((SC|ST)\)', '', name), 'res': res and res.group(1),
                        'person': None if vac else person, 'party': None if vac or str(r.iloc[pt]) == 'nan' else party(r.iloc[pt])})
        best = (rows, out)
    if not best: return []
    # A seat listed twice (resigned, then a by-election) keeps its last row.
    seen = {}
    for m in best[1]: seen[m['no'] if m['no'] is not None else norm(m['seat'])] = m
    return list(seen.values())

def lok_sabha():
    from bs4 import BeautifulSoup
    soup, out = BeautifulSoup(wiki(LS_PAGE), 'lxml'), {}
    for tb in soup.find_all('table', class_='wikitable'):
        head = tb.find_previous(['h2', 'h3']).get_text(' ', strip=True)
        rows = members(str(tb), 0)
        if rows and head not in out: out[head] = rows
    return out

def main():
    st = gpd.read_parquet(fetch(REL + FILES['states'], 'states.parquet'))
    ds = gpd.read_parquet(fetch(REL + FILES['districts'], 'districts.parquet'))
    acs = gpd.read_parquet(fetch(REL + FILES['acs'], 'acs.parquet'))
    ls = lok_sabha()
    OUT.mkdir(parents=True, exist_ok=True)
    states, index = [], {'updated': date.today().isoformat(),
        'attribution': 'State, district and assembly seat outlines: Local Government Directory, via india-geodata (CC0). Simplified to about 200 m.',
        'sources': {'boundaries': 'https://github.com/yashveeeeeeer/india-geodata', 'mp': WIKI + LS_PAGE.replace(' ', '_')}, 'states': {}}
    report = []
    for _, s in st.sort_values('State_LGD').iterrows():
        code, name = int(s.State_LGD), WNAME.get(int(s.State_LGD), title(s.Remarks or s.STNAME))
        if code == 37: name = 'Ladakh'
        sl = slug(name)
        geom, bbox = outline([s.geometry], TOL_STATE)
        states.append({'type': 'Feature', 'bbox': bbox, 'properties': {'state': name, 'slug': sl, 'code': code}, 'geometry': geom})
        if code in SKIP: continue
        info = {'name': name, 'bbox': bbox}
        feats = []
        for _, d in ds[ds.state_lgd.astype(int) == code].sort_values('dtname').iterrows():
            g, b = outline([d.geometry], TOL)
            feats.append({'type': 'Feature', 'bbox': b, 'properties': {'kind': 'district', 'district': clean(d.dtname)}, 'geometry': g})
        info['districts'] = len(feats)
        mps = ls.get(name) or []
        info['mps'] = len([m for m in mps if m['person']])
        page = 'Delhi Legislative Assembly' if code == 7 else f'{name} Legislative Assembly'
        a = acs[acs.State_LGD.astype(int) == AC_STATE.get(code, code)]
        if code in NO_ASSEMBLY: a = a.iloc[0:0]
        if code in NO_SEAT_MAP or a.empty:
            info['note'] = NO_SEAT_MAP.get(code)
            if not a.empty or code in NO_SEAT_MAP: info['mla_list'] = WIKI + page.replace(' ', '_')
            # One seat for the whole territory (or by district, Dadra and Nagar Haveli / Daman and Diu): its MP.
            live = [m for m in mps if m['person']]
            if code not in NO_SEAT_MAP and live:
                info['mp'] = [{'pc': m['no'], 'name': m['seat'], 'person': m['person'], 'party': m['party']} for m in live]
            index['states'][sl] = info
            (OUT / f'{sl}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')))
            report.append(f'{name}: {len(feats)} districts, no seat map, MPs {info["mps"]}')
            continue
        mlas = members(wiki(page), len(a.ac_no.unique()))
        by_no = {m['no']: m for m in mlas if m['no'] is not None}
        mp_no = {m['no']: m for m in mps if m['no'] is not None}
        rows = [(no, grp.iloc[0], grp) for no, grp in sorted(a.groupby(a.ac_no.astype(int)), key=lambda x: x[0]) if no > 0]
        pcno_of = lambda r: int(float(r.pc_no)) if re.fullmatch(r'\d+(\.0)?', str(r.pc_no)) else None
        # Numbers are trusted for a seat whose name differs (a renamed seat) only where nearly all
        # other numbers carry the same name, i.e. the file and Wikipedia number seats alike.
        def trusted(pairs):
            hits = [same(x, y) for x, y in pairs if x is not None]
            return len(hits) > 0 and sum(hits) >= .9 * len(hits)
        ac_ok = trusted([(by_no[no]['seat'] if no in by_no else None, clean(r.ac_name)) for no, r, _ in rows])
        pc_ok = trusted([(mp_no[pcno_of(r)]['seat'] if pcno_of(r) in mp_no else None, clean(r.pc_name)) for _, r, _ in rows])
        picks, seats, matched, mp_matched, dropped = [], 0, 0, 0, 0
        # Pass 1: the same number and name in both. Pass 2, seats left over: where numbers can be
        # trusted, the member under that number (a renamed seat); elsewhere the one member of that
        # name, then of a near spelling (Cheepurupalle / Cheepurupalli). A member is used once.
        for no, r, grp in rows:
            m = by_no[no] if no in by_no and same(by_no[no]['seat'], clean(r.ac_name)) else None
            picks.append([no, r, grp, m, None])
        used = {id(x[3]) for x in picks if x[3]}
        for x in picks:
            no, r = x[0], x[1]
            seat, pcno, pcname = clean(r.ac_name), pcno_of(r), clean(r.pc_name)
            p = mp_no[pcno] if pcno in mp_no and same(mp_no[pcno]['seat'], pcname) else by_name(mps, pcname, fuzzy=True)
            if not x[3]:
                named = by_name(mlas, seat, used=used)
                # Neither the seat nor its Lok Sabha seat is this state's: a fragment of a neighbour's seat.
                if not named and not p: x[2] = None; dropped += 1; continue
                if ac_ok: x[3] = by_no.get(no) if no in by_no and id(by_no[no]) not in used else None
                else: x[3] = named or by_name(mlas, seat, fuzzy=True, used=used)
                if x[3]: used.add(id(x[3]))
            if not p and pc_ok and pcno in mp_no: p = mp_no[pcno]
            x[4] = p
        for no, r, grp, m, p in picks:
            if grp is None: continue
            seat, pcname = clean(r.ac_name), clean(r.pc_name)
            g, b = outline(list(grp.geometry), TOL)
            props = {'kind': 'ac', 'ac': m['no'] if m else no if ac_ok else None, 'name': m['seat'] if m else title(seat), 'pc': p['seat'] if p else title(pcname)}
            if m:
                matched += 1
                props.update(mla=m['person'], mla_party=m['party']) if m['person'] else props.update(mla_vacant=True)
            if p:
                mp_matched += 1
                props.update(mp=p['person'], mp_party=p['party']) if p['person'] else props.update(mp_vacant=True)
            seats += 1
            feats.append({'type': 'Feature', 'bbox': b, 'properties': props, 'geometry': g})
        info.update(seats=seats, seats_total=len(mlas), mla_matched=matched, mp_matched=mp_matched, mla_list=WIKI + page.replace(' ', '_'))
        index['states'][sl] = info
        (OUT / f'{sl}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')))
        report.append(f'{name}: {info["districts"]} districts, {seats} seat outlines of {len(mlas)} seats ({dropped} neighbour fragments dropped), MLA matched {matched}, MP matched {mp_matched}/{seats}')
    (ROOT / 'places' / 'in_states.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': states}, separators=(',', ':')))
    (OUT / 'index.json').write_text(json.dumps(index, indent=1, ensure_ascii=False))
    print('\n'.join(report))

if __name__ == '__main__':
    main()
