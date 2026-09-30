#!/usr/bin/env python3
"""Who runs each district and block, from each district's own website.

    python3 tools/build-wb-officials.py

Reads the "Who's Who" page of every West Bengal district site (S3WaaS, *.gov.in /
ddinajpur.nic.in): the District Magistrate, the Additional District Magistrate who
is the Zilla Parishad's executive officer, and each Block Development Officer (the
Panchayat Samiti's executive officer), with the office phone and email the site
lists. Blocks are matched to the names in places/wb/*.geojson and purulia_blocks.geojson.
A site that can't be reached or lists nobody keeps its previous entry.
Writes places/wb_officials.json.
"""
import difflib, html, json, re, subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'places' / 'wb_officials.json'
SITES = {
    'alipurduar': 'https://alipurduar.gov.in/about-district/whos-who/', 'bankura': 'https://bankura.gov.in/whos-who/',
    'birbhum': 'https://birbhum.gov.in/whos-who/', 'cooch-behar': 'https://coochbehar.gov.in/about-district/whos-who/',
    'dakshin-dinajpur': 'https://ddinajpur.nic.in/about-district/whos-who/', 'darjeeling': 'https://darjeeling.gov.in/about-district/whos-who/',
    'hooghly': 'https://hooghly.gov.in/about-district/whos-who/', 'howrah': 'https://howrah.gov.in/whos-who/',
    'jalpaiguri': 'https://jalpaiguri.gov.in/whos-who/', 'jhargram': 'https://jhargram.gov.in/about-district/whos-who/',
    'kalimpong': 'https://kalimpong.gov.in/about-district/whos-who/', 'malda': 'https://malda.gov.in/about-district/whos-who/',
    'murshidabad': 'https://murshidabad.gov.in/about-district/whos-who/', 'nadia': 'https://nadia.gov.in/about-district/whos-who/',
    'north-24-parganas': 'https://north24parganas.gov.in/about-district/whos-who/',
    'paschim-bardhaman': 'https://paschimbardhaman.gov.in/about-district/whos-who/',
    'paschim-medinipur': 'https://paschimmedinipur.gov.in/about-district/whos-who/',
    'purba-bardhaman': 'https://purbabardhaman.gov.in/about-district/whos-who/',
    'purba-medinipur': 'https://purbamedinipur.gov.in/about-district/whos-who/', 'purulia': 'https://purulia.gov.in/whos-who/',
    'south-24-parganas': 'https://s24pgs.gov.in/about-district/whos-who/', 'uttar-dinajpur': 'https://uttardinajpur.gov.in/about-district/whos-who/',
}
# Where the whos-who page has no DM row, the same site's home page (or DM profile page) names the DM.
HOME = {d: re.match(r'https://[^/]+/', u).group(0) for d, u in SITES.items()} | {'birbhum': 'https://birbhum.gov.in/dm-profiles/'}

def get(url):
    for _ in range(3):  # the state's sites often drop the first connection
        r = subprocess.run(['curl', '-sS', '-m', '40', '-L', '-f', url], capture_output=True, text=True, errors='ignore')
        if r.returncode == 0: return r.stdout

def clean(s): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()
def email(s): return s.replace('[at]', '@').replace('[dot]', '.').replace(' ', '') if '[at]' in s else ''
def tidy(s):
    """'Shri BISWARUP BISWAS, W.B.C.S (EXE.)' -> 'Shri Biswarup Biswas' (service tags dropped, sites mix cases)."""
    s = re.sub(r'\s*[,\[(]?\s*\b(I\.?\s?A\.?\s?S|W\.?\s?B\.?\s?C\.?\s?S)\b.*$', '', s, flags=re.I).strip(' ,')
    return ' '.join(w.title() if len(w.strip('.,')) > 1 and w.isupper() else w for w in s.split())
def person(s):
    s = re.sub(r'^(the\s+)?(block development officers?|bdo\b.*|additional district magistrate.*|district magistrate.*)$', '', s.strip(), flags=re.I)
    return '' if not s or s.upper() == s and len(s) < 5 else tidy(s)
def norm(s):
    s = re.sub(r'block development officers?|\bbdo\b|development block|\bblock\b|\bthe\b|office of', ' ', s.lower())
    return ''.join({'i': '1', 'ii': '2', 'iii': '3'}.get(t, t) for t in re.findall(r'[a-z]+|\d+', s))

def dm_on(page):
    """The IAS officer a home page captions as District Magistrate / Collector / Current DM."""
    cells = [c for c in (clean(x) for x in re.split(r'<[^>]+>', page)) if c]
    for i, c in enumerate(cells):
        if len(c) < 60 and re.search(r'\bI\.?A\.?S\.?$', c) and \
           re.search(r'district magistrate|collector|current dm', ' '.join(cells[max(0, i - 2):i + 3]), re.I):
            return re.sub(r',?\s*I\.?A\.?S\.?$', '', c)

def rows(page):
    out = []
    for cat, sec in re.findall(r'(?s)<div class="whoswho"[^>]*data-name="([^"]*)"(.*?)</table>', page):
        hdr = [clean(h).lower() for h in re.findall(r'(?s)<th[^>]*>(.*?)</th>', sec)]
        for tr in re.findall(r'(?s)<tr>(.*?)</tr>', sec.split('<tbody>')[-1]):
            r = dict(zip(hdr, [clean(c) for c in re.findall(r'(?s)<td[^>]*>(.*?)</td>', tr)]))
            r['cat'] = clean(cat)
            out.append(r)
    return out

def block_names(d):
    fn = ROOT / 'purulia_blocks.geojson' if d == 'purulia' else ROOT / 'places' / 'wb' / f'{d}.geojson'
    if not fn.exists(): return {}
    return {norm(f['properties']['block']): f['properties']['block'] for f in json.load(open(fn))['features']
            if f['properties'].get('kind', 'block') == 'block'}

ALIAS = {'joypur': 'jaipur',                     # Purulia's site spells Jaipur block "Joypur"
         'bhagawangola2': 'bhagabangola2',         # our outlines spell the two Bhagawangola blocks differently
         'murshidabadjiaganj': 'murshidabadjiagunj'}
SADAR = {'jalpaiguri': 'jalpaiguri', 'paschim-medinipur': 'midnapore'}  # "Sadar" block = the one named after the town

def match(names, pieces, district):
    """The block a row names: its designation first, then its address, then the name column."""
    dn = norm(district)
    for piece in pieces:
        full = norm(piece)
        ks = [full]
        if dn in full and re.search(r'[a-z]', full.replace(dn, '')): ks.append(full.replace(dn, ''))
        if re.search(r'\bsadar\b', piece, re.I) and district in SADAR: ks.insert(0, SADAR[district])
        for k in ks:
            k = ALIAS.get(k, k)
            if not k: continue
            if k in names: return names[k]
            hit = sorted((nb for nb in names if nb and nb in k), key=len, reverse=True)
            if hit and (len(hit) == 1 or len(hit[0]) > len(hit[1])): return names[hit[0]]
            best = difflib.get_close_matches(k, list(names), n=2, cutoff=0.8)
            if len(best) == 1 or (best and difflib.SequenceMatcher(None, k, best[0]).ratio() > difflib.SequenceMatcher(None, k, best[1]).ratio() + .05):
                return names[best[0]]
    return None

old = json.load(open(OUT)) if OUT.exists() else {'districts': {}}
res = {'checked': date.today().isoformat(), 'districts': {}}
for d, url in SITES.items():
    page = get(url)
    rs = rows(page) if page else []
    e = {'source': url} if rs else {}
    for r in rs:
        who, what = r.get('name', ''), r.get('designation', '')
        entry = {k: v for k, v in {'name': person(who), 'role': what or who, 'phone': r.get('phone', '') or r.get('phone number', ''),
                                   'email': email(r.get('email', ''))}.items() if v}
        if re.search(r'^(district magistrate|collector)', what, re.I) and 'dm' not in e: e['dm'] = entry
        elif re.search(r'zilla parishad', what + ' ' + who, re.I) and re.search(r'additional district magistrate|a\.d\.m', what + ' ' + who, re.I):
            e['zp'] = entry
    names, bdos = block_names(d), {}
    for r in rs:
        text = ' '.join([r['cat'], r.get('designation', ''), r.get('name', '')])
        if not re.search(r'block development|\bbdo\b', text, re.I): continue
        b = match(names, [r.get('designation', ''), r.get('address', ''), r.get('name', '')], d)
        if b and b not in bdos:
            bdos[b] = {k: v for k, v in {'name': person(r.get('name', '')), 'phone': r.get('phone', ''), 'email': email(r.get('email', ''))}.items() if v}
    if bdos: e['bdo'] = bdos
    if 'name' not in e.get('dm', {}) and (p := get(HOME[d])) and (n := dm_on(p)):
        e['dm'] = {'name': tidy(n), 'role': 'District Magistrate', **{k: v for k, v in e.get('dm', {}).items() if k in ('phone', 'email')}}
        e['dm_source'] = HOME[d]
    if not e:
        if d in old['districts']: res['districts'][d] = old['districts'][d]
        print(f'{d:18} unreachable or empty, kept {"old" if d in old["districts"] else "nothing"}')
        continue
    res['districts'][d] = e
    print(f"{d:18} DM {'yes' if 'dm' in e else 'no '}  ZP {'yes' if 'zp' in e else 'no '}  BDOs {len(bdos)}/{len(names)}")
json.dump(res, open(OUT, 'w'), ensure_ascii=False, indent=1)
