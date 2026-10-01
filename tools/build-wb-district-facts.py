#!/usr/bin/env python3
"""Build places/wb_district_facts.json: sourced facts for every West Bengal district.

Each figure keeps its source, so pages can cite it next to the number:
- Wikidata (CC0): Census 2011 population, male/female, urban/rural, households,
  area, headquarters, official website, Bengali name. Matched on LGD district code.
- Wikipedia (CC BY-SA): the article's lead paragraph, with the revision it came from.
- NFHS-5 (2019-21) district fact sheets, IIPS / MoHFW, with NFHS-4 (2015-16) for
  change. Read from github.com/pratapvardhan/NFHS-5, which transcribes them.
  NFHS-5 used the 20 districts that existed before 2017: Alipurduar is counted
  in Jalpaiguri, Kalimpong in Darjeeling, Jhargram in Paschim Medinipur.
- Jal Jeevan Mission dashboard (Ministry of Jal Shakti): rural homes with a tap.
- NITI Aayog Aspirational Districts Programme list.

Run: python3 tools/build-wb-district-facts.py   (the refresh-place-data workflow runs it monthly)
A source that fails keeps the previous file's values for it, so a bad day never blanks the site.
"""
import csv, datetime, io, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'places', 'wb_district_facts.json')
UA = 'ParishkarBengal/1.0 (https://github.com/archiboltmusk/Purulia; monthly data refresh)'
TODAY = datetime.date.today().isoformat()

NFHS_DIST = 'https://raw.githubusercontent.com/pratapvardhan/NFHS-5/master/NFHS-5-Districts.csv'
NFHS_STATE = 'https://raw.githubusercontent.com/pratapvardhan/NFHS-5/master/NFHS-5-States.csv'
NFHS_URL = 'https://rchiips.org/nfhs/districtfactsheet_NFHS-5.shtml'
JJM_API = 'https://ejalshakti.gov.in/jjmreport/JJMDistrictView.aspx/Bind_table_graph'
JJM_URL = 'https://ejalshakti.gov.in/jjmreport/JJMDistrictView.aspx'
NITI_URL = 'https://www.niti.gov.in/aspirational-districts-programme'
# NITI Aayog's 112 aspirational districts: the West Bengal ones (by our slug).
ASPIRATIONAL = {'birbhum', 'dakshin-dinajpur', 'malda', 'murshidabad', 'nadia'}

# NFHS-5 district name for each of our slugs (pre-2017 districts where split since).
NFHS_NAME = {
    'alipurduar': 'Jalpaiguri', 'bankura': 'Bankura', 'birbhum': 'Birbhum', 'cooch-behar': 'Koch Bihar',
    'dakshin-dinajpur': 'Dakshin Dinajpur', 'darjeeling': 'Darjeeling', 'hooghly': 'Hugli', 'howrah': 'Haora',
    'jalpaiguri': 'Jalpaiguri', 'jhargram': 'Paschim Medinipur', 'kalimpong': 'Darjeeling', 'kolkata': 'Kolkata',
    'malda': 'Maldah', 'murshidabad': 'Murshidabad', 'nadia': 'Nadia',
    'north-24-parganas': 'North Twenty Four Parganas', 'paschim-bardhaman': 'Paschim Barddhaman',
    'paschim-medinipur': 'Paschim Medinipur', 'purba-bardhaman': 'Purba Barddhaman',
    'purba-medinipur': 'Purba Medinipur', 'purulia': 'Puruliya',
    'south-24-parganas': 'South Twenty Four Parganas', 'uttar-dinajpur': 'Uttar Dinajpur'}

# Districts carved out after the NFHS-5 district frame -> the district NFHS-5 counted them in.
SPLIT = {'alipurduar': 'Jalpaiguri', 'kalimpong': 'Darjeeling', 'jhargram': 'Paschim Medinipur'}

# (key, text found in the NFHS indicator, higher_is_better, plain label)
NFHS_PICK = [
    ('child_anaemia', 'Children age 6-59 months who are anaemic', False, 'Young children with anaemia'),
    ('women_anaemia', 'All women age 15-49 years who are anaemic', False, 'Women with anaemia'),
    ('underweight', 'Children under 5 years who are underweight', False, 'Children under 5 who are underweight'),
    ('stunted', 'Children under 5 years who are stunted', False, 'Children under 5 who are stunted'),
    ('wasted', 'Children under 5 years who are wasted', False, 'Children under 5 who are wasted'),
    ('women_literate', 'Women who are literate', True, 'Women who can read and write'),
    ('women_10yrs', 'Women with 10 or more years of schooling', True, 'Women with 10+ years of school'),
    ('sanitation', 'use an improved sanitation facility', True, 'People with a proper toilet'),
    ('clean_fuel', 'Households using clean fuel for cooking', True, 'Homes cooking with clean fuel'),
    ('water', 'improved drinking-water source', True, 'People with safe drinking water'),
    ('electricity', 'households with electricity', True, 'People with electricity at home'),
    ('child_marriage', 'Women age 20-24 years married before age 18', False, 'Young women married before 18'),
    ('teen_mothers', 'Women age 15-19 years who were already mothers', False, 'Teenage girls already mothers or pregnant'),
    ('anc4', 'Mothers who had at least 4 antenatal care visits', True, 'Mothers with 4+ antenatal check-ups'),
    ('inst_births', 'Institutional births (%)', True, 'Births in a hospital or clinic'),
    ('vaccinated', 'fully vaccinated based on information from either', True, 'Children fully vaccinated'),
    ('insurance', 'covered under a health insurance/financing scheme', True, 'Homes with any health cover'),
]


def get(url, data=None, headers=None, tries=4):
    h = {'User-Agent': UA, **(headers or {})}
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode('utf-8')
        except Exception as e:  # noqa: BLE001 - retry any network error
            if i == tries - 1: raise
            print('  retry', url[:70], e, file=sys.stderr)
            time.sleep(5 * (i + 1))


def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None


def districts():
    g = json.load(open(os.path.join(ROOT, 'places', 'wb_districts.geojson'), encoding='utf-8'))
    return {f['properties']['slug']: {'name': f['properties']['district'], 'lgd': f['properties']['lgd']}
            for f in g['features']}


def wikidata(ds):
    lgds = ' '.join('"%s"' % d['lgd'] for d in ds.values())
    q = '''SELECT ?lgd ?d ?bn ?hqLabel ?web ?area ?art ?pop ?pt ?m ?f ?u ?r ?hh WHERE {
      VALUES ?lgd { %s } ?d wdt:P12746 ?lgd.
      OPTIONAL { ?d rdfs:label ?bn FILTER(lang(?bn) = "bn") }
      OPTIONAL { ?d wdt:P36 ?hq } OPTIONAL { ?d wdt:P856 ?web } OPTIONAL { ?d wdt:P2046 ?area }
      OPTIONAL { ?art schema:about ?d; schema:isPartOf <https://en.wikipedia.org/> }
      OPTIONAL { ?d p:P1082 ?ps. ?ps ps:P1082 ?pop. OPTIONAL { ?ps pq:P585 ?pt } }
      OPTIONAL { ?d wdt:P1540 ?m } OPTIONAL { ?d wdt:P1539 ?f } OPTIONAL { ?d wdt:P6343 ?u }
      OPTIONAL { ?d wdt:P6344 ?r } OPTIONAL { ?d wdt:P1538 ?hh }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }''' % lgds
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': q})
    rows = json.loads(get(url, headers={'Accept': 'application/sparql-results+json'}))['results']['bindings']
    by_lgd = {}
    for x in rows:
        v = {k: x[k]['value'] for k in x}
        o = by_lgd.setdefault(v['lgd'], {'pops': {}})
        for k in ('d', 'bn', 'hqLabel', 'web', 'area', 'art', 'm', 'f', 'u', 'r', 'hh'):
            if k in v: o[k] = v[k]
        if 'pop' in v: o['pops'][(v.get('pt') or '')[:4]] = int(float(v['pop']))
    out = {}
    for slug, d in ds.items():
        o = by_lgd.get(str(d['lgd']))
        if not o: continue
        pop = o['pops'].get('2011')
        c = {'population': pop}
        if pop:  # only the breakdowns that add up to the 2011 count are Census 2011 figures
            m, f = num(o.get('m')), num(o.get('f'))
            if m and f and abs(m + f - pop) < 5: c.update(male=int(m), female=int(f))
            u, r = num(o.get('u')), num(o.get('r'))
            if u is not None and r is not None and abs(u + r - pop) < 5: c.update(urban=int(u), rural=int(r))
            if o.get('hh'): c['households'] = int(float(o['hh']))
        out[slug] = {
            'wikidata': o['d'], 'name_bn': (o.get('bn') or '').replace('জেলা', '').strip() or None,
            'hq': o.get('hqLabel'), 'website': o.get('web'),
            'area_km2': num(o.get('area')), 'wikipedia': o.get('art'),
            'census2011': {k: v for k, v in c.items() if v is not None} if pop else None}
    return out


def wikipedia(titles):
    out = {}
    titles = [t for t in titles if t]
    for i in range(0, len(titles), 20):
        batch = titles[i:i + 20]
        url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'formatversion': 2, 'redirects': 1,
            'prop': 'extracts|revisions', 'exintro': 1, 'explaintext': 1, 'exlimit': 'max', 'rvprop': 'ids',
            'titles': '|'.join(batch)})
        for p in json.loads(get(url))['query']['pages']:
            text = re.sub(r'\s+', ' ', re.sub(r'\([^()]*\)', '', p.get('extract') or '')).replace(' ,', ',').strip()
            paras = [s for s in re.split(r'(?<=[.!?])\s+', text) if s]
            lead, n = [], 0
            for s in paras:  # first sentences up to ~420 characters
                if n and n + len(s) > 420: break
                lead.append(s); n += len(s)
            rev = (p.get('revisions') or [{}])[0].get('revid')
            out[p['title']] = {'text': ' '.join(lead), 'revid': rev}
        time.sleep(1)
    return out


def nfhs():
    dist = list(csv.DictReader(io.StringIO(get(NFHS_DIST))))
    state = list(csv.DictReader(io.StringIO(get(NFHS_STATE))))
    pick = lambda ind: next((p for p in NFHS_PICK if p[1] in ind), None)
    per = {}
    for r in dist:
        if r['State-Code'] != 'WB': continue
        p = pick(r['Indicator'])
        if p and p[0] not in per.setdefault(r['District'], {}):
            per[r['District']][p[0]] = [num(r['NFHS-5']), num(r['NFHS-4'])]
    ref = {'west_bengal': {}, 'india': {}}
    for r in state:
        p = pick(r['indicator'])
        if not p: continue
        k = {'West Bengal': 'west_bengal', 'India': 'india'}.get(r['state'])
        if k and p[0] not in ref[k]: ref[k][p[0]] = num(r['nfhs5_total'])
    assert len(per) == 20, len(per)
    assert per['Puruliya']['child_anaemia'] == [77.9, 66.8], per['Puruliya']['child_anaemia']
    assert per['Puruliya']['underweight'][0] == 46.3 and per['Puruliya']['women_literate'][0] == 61.0
    return per, ref


def jjm():
    body = json.dumps({'StCode11': '19', 'Cat': '11', 'SubCat': '11', 'Param': '21'}).encode()
    for i in range(4):  # the dashboard sometimes answers with an empty list
        rows = json.loads(get(JJM_API, data=body, headers={'Content-Type': 'application/json'}))['d']
        if rows: break
        time.sleep(10 * (i + 1))
    slug = lambda s: re.sub(r'[^a-z0-9]+', '-', s.strip().lower()).strip('-')
    out, india = {}, len(rows)
    for x in rows:
        if x['StateName'] != 'West Bengal': continue
        s = slug(x['Name'])
        out[s] = {'pct': num(x['Per']), 'tap': int(x['Value']), 'homes': int(x['Total']),
                  'rank_india': int(x['AllIndiaRank']), 'of_india': india}
    ranked = sorted(out, key=lambda s: -out[s]['pct'])
    for s in out: out[s].update(rank_wb=ranked.index(s) + 1, of_wb=len(out))
    assert len(out) >= 22, sorted(out)
    return out


def main():
    ds = districts()
    old = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {'districts': {}, 'sources': {}}
    res = {'generated': TODAY, 'sources': dict(old.get('sources') or {}), 'nfhs': old.get('nfhs'),
           'districts': {s: dict((old['districts'].get(s) or {}), name=d['name'], lgd=d['lgd'],
                                 aspirational=s in ASPIRATIONAL) for s, d in ds.items()}}
    res['sources']['niti'] = {'name': 'Aspirational Districts Programme, NITI Aayog', 'url': NITI_URL}

    def step(name, fn):
        try:
            fn(); print('ok', name)
        except Exception as e:  # noqa: BLE001 - keep last good values for this source
            print('FAILED', name, e, file=sys.stderr)

    def do_wd():
        wd = wikidata(ds)
        for s, v in wd.items(): res['districts'][s].update(v)
        res['sources']['wikidata'] = {'name': 'Wikidata (Census of India 2011 figures)', 'licence': 'CC0', 'read': TODAY}

    def do_wp():
        titles = {s: (d.get('wikipedia') or '').rsplit('/', 1)[-1] for s, d in res['districts'].items()}
        titles = {s: urllib.parse.unquote(t).replace('_', ' ') for s, t in titles.items() if t}
        wp = wikipedia(list(titles.values()))
        for s, t in titles.items():
            if wp.get(t) and wp[t]['text']: res['districts'][s]['about'] = wp[t]
        res['sources']['wikipedia'] = {'name': 'Wikipedia', 'licence': 'CC BY-SA 4.0', 'read': TODAY}

    def do_nfhs():
        per, ref = nfhs()
        res['nfhs'] = {'indicators': {k: {'label': l, 'higher_is_better': h} for k, _, h, l in NFHS_PICK},
                       'districts': per, **ref}
        for s in ds:
            res['districts'][s]['nfhs_district'] = NFHS_NAME[s]
            if s in SPLIT: res['districts'][s]['nfhs_part_of'] = SPLIT[s]
        res['sources']['nfhs'] = {'name': 'NFHS-5 (2019-21) and NFHS-4 (2015-16) district fact sheets, IIPS / MoHFW',
                                  'url': NFHS_URL, 'read': TODAY}

    def do_jjm():
        j = jjm()
        for s in ds:
            if s in j: res['districts'][s]['jjm'] = j[s]
        res['sources']['jjm'] = {'name': 'Jal Jeevan Mission dashboard, Ministry of Jal Shakti', 'url': JJM_URL, 'read': TODAY}

    for n, f in (('wikidata', do_wd), ('wikipedia', do_wp), ('nfhs', do_nfhs), ('jjm', do_jjm)): step(n, f)
    missing = sorted(s for s, d in res['districts'].items() if not d.get('census2011'))
    print('no Census 2011 on Wikidata:', missing or 'none')
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    print('wrote', os.path.relpath(OUT, ROOT), len(res['districts']), 'districts')


if __name__ == '__main__':
    main()
