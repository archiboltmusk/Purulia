#!/usr/bin/env python3
"""Sourced last-election results for every MLA (ac) and MP (pc) of one Indian state.

Writes places/in/profiles/<state>.json: per seat the last result (winner, party,
votes, vote share, runner-up, margin, turnout) from Wikipedia's results tables,
plus the current holder from places/in/<state>.geojson (MLA/MP fields, set by
build-in-map.py). Percentiles are over sourced result metrics only, within the
same house and state. No chance or forecast figure is computed here.

Usage: python3 tools/build-in-profiles.py uttar-pradesh
"""
import datetime
import io
import json
import re
import subprocess
import sys
import urllib.parse
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'data' / '.in-cache'

# Last general elections, per state. Pages are Wikipedia results pages (ECI figures).
SOURCES = {
    'uttar-pradesh': {
        'ac_page': '2022 Uttar Pradesh Legislative Assembly election',
        'pc_page': '2024 Indian general election in Uttar Pradesh',
        'pc_prev_page': '2019 Indian general election in Uttar Pradesh',
        'ac_year': 2022, 'pc_year': 2024, 'pc_prev_year': 2019,
    },
    'maharashtra': {
        'ac_page': '2024 Maharashtra Legislative Assembly election',
        'pc_page': '2024 Indian general election in Maharashtra',
        'pc_prev_page': '2019 Indian general election in Maharashtra',
        'ac_year': 2024, 'pc_year': 2024, 'pc_prev_year': 2019,
    },
}


# Wikipedia result names that differ from the state file's Lok Sabha name.
ALIASES = {'G. B. Nagar': 'Gautam Buddha Nagar'}


def clean(s):
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]', '', str(s))).strip()


def wiki(page):
    slug = re.sub(r'[^a-z0-9]+', '-', page.lower()).strip('-')
    f = CACHE / f'{slug}.html'
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        url = f'https://en.wikipedia.org/w/index.php?title={urllib.parse.quote(page.replace(" ", "_"))}&action=render'
        subprocess.run(['curl', '-sSfL', '-A', 'ParishkarBengal-builder/1.0', '-o', str(f), url], check=True)
    return f.read_text()


def flat(col):
    return ' '.join(clean(x) for x in (col if isinstance(col, tuple) else (col,)) if clean(x) and clean(x) != 'nan').lower()


def results_table(html):
    """The constituency-wise table: has a seat number, a winner and a runner-up with votes."""
    for t in pd.read_html(io.StringIO(html)):
        c = [flat(x) for x in t.columns]
        if len(t) < 20: continue
        if not any('runner' in x for x in c) or not any('margin' in x for x in c): continue
        if not any(re.search(r'\bname\b', x) for x in c): continue
        return t
    raise SystemExit('results table not found')


def col(t, *needles, nth=0, exclude=()):
    hits = [i for i, x in enumerate([flat(c) for c in t.columns])
            if all(n in x for n in needles) and not any(e in x for e in exclude)]
    return hits[nth] if len(hits) > nth else None


def num(v):
    try:
        f = float(str(v).replace(',', ''))
        return None if f != f else f
    except ValueError:
        return None


def parse(html):
    t = results_table(html)
    i_no = col(t, '#')
    i_name = col(t, 'name')
    i_turn = col(t, 'turnout') if col(t, 'turnout') is not None else col(t, 'poll')
    w_cand = col(t, 'winner', 'candidate') if col(t, 'winner', 'candidate') is not None else col(t, 'winner', nth=0, exclude=('party', 'votes', '%'))
    w_party = max([i for i, x in enumerate([flat(c) for c in t.columns]) if 'winner' in x and 'party' in x] or [None],
                  key=lambda i: (i is not None, t.iloc[:, i].notna().sum() if i is not None else -1))
    w_votes = col(t, 'winner', 'votes')
    w_pct = next(i for i, c in enumerate(t.columns) if 'winner' in flat(c) and clean(c[-1] if isinstance(c, tuple) else c) == '%')
    r_cand = col(t, 'runner', 'candidate')
    r_party = max([i for i, x in enumerate([flat(c) for c in t.columns]) if 'runner' in x and 'party' in x] or [None],
                  key=lambda i: (i is not None, t.iloc[:, i].notna().sum() if i is not None else -1))
    r_votes = col(t, 'runner', 'votes')
    r_pct = next(i for i, c in enumerate(t.columns) if 'runner' in flat(c) and clean(c[-1] if isinstance(c, tuple) else c) == '%')
    margin = col(t, 'margin', nth=0)
    out = {}
    for _, r in t.iterrows():
        no = num(str(r.iloc[i_no]).split('.')[0]) if i_no is not None else None
        if no is None: continue
        name = re.sub(r'\s*\((SC|ST)\)\s*$', '', clean(r.iloc[i_name]))
        res = re.search(r'\((SC|ST)\)', clean(r.iloc[i_name]))
        out[int(no)] = {
            'seat': name,
            'reserved': res and res.group(1),
            'turnout': num(r.iloc[i_turn]) if i_turn is not None else None,
            'winner': clean(r.iloc[w_cand]),
            'winner_party': clean(r.iloc[w_party]) if w_party is not None else None,
            'winner_votes': num(r.iloc[w_votes]),
            'winner_pct': num(r.iloc[w_pct]),
            'runner_up': clean(r.iloc[r_cand]),
            'runner_up_party': clean(r.iloc[r_party]) if r_party is not None else None,
            'runner_up_votes': num(r.iloc[r_votes]),
            'runner_up_pct': num(r.iloc[r_pct]),
            'margin': num(r.iloc[margin]) if margin is not None else None,
        }
        o = out[int(no)]
        o['margin_pct'] = None if o['winner_pct'] is None or o['runner_up_pct'] is None else round(o['winner_pct'] - o['runner_up_pct'], 2)
    return out


def norm(s):
    return re.sub(r'[^a-z]', '', s.lower())


def trend(row, prev):
    """Change in vote share of the same party's candidate, 2019 -> 2024 (party-level, not person)."""
    out = {'prev_year_winner': None, 'prev_winner_pct': None, 'trend_pp': None, 'trend_party': None}
    if not prev: return out
    out['prev_year_winner'] = prev['winner_party']
    party = row['winner_party']
    if party and party == prev['winner_party']:
        share = prev['winner_pct']
    elif party and party == prev['runner_up_party']:
        share = prev['runner_up_pct']
    else:
        return out
    if share is None or row['winner_pct'] is None: return out
    out.update({'trend_party': party, 'prev_winner_pct': share, 'trend_pp': round(row['winner_pct'] - share, 2)})
    return out


def band(row):
    """Label from sourced results only. Thresholds are on the page."""
    m, t = row.get('margin_pct'), row.get('trend_pp')
    if m is None: return None, 'no result'
    if t is None:
        return ('close' if m < 5 else 'marginal' if m < 10 else 'comfortable'), 'margin only'
    if m < 5: return 'close', 'margin + trend'
    if m < 10 or t <= -5: return 'marginal', 'margin + trend'
    return 'comfortable', 'margin + trend'


def percentiles(rows, key):
    vals = sorted(r[key] for r in rows.values() if r.get(key) is not None)
    n = len(vals)
    for r in rows.values():
        v = r.get(key)
        if v is None or n < 2:
            r[f'pct_{key}'] = None
            continue
        below = sum(1 for x in vals if x < v)
        r[f'pct_{key}'] = round(100 * below / (n - 1))


def main(state):
    src = SOURCES[state]
    gj = json.loads((ROOT / 'places' / 'in' / f'{state}.geojson').read_text())
    feats = [f['properties'] for f in gj['features'] if f['properties'].get('kind') == 'ac']

    ac = parse(wiki(src['ac_page']))
    pc = parse(wiki(src['pc_page']))
    pc_prev = parse(wiki(src['pc_prev_page']))
    prev_by_name = {norm(r['seat']): r for r in pc_prev.values()}

    members = {'ac': {}, 'pc': {}}
    gaps = {'ac_no_result': [], 'ac_no_holder': [], 'pc_no_result': [], 'pc_no_holder': []}

    # MLAs: match by seat number (ECI constituency number), holder from the state file.
    for p in feats:
        no = p.get('ac')
        r = ac.get(no)
        row = {'no': no, 'seat': p.get('name'), 'lok_sabha': p.get('pc'),
               'holder': p.get('mla'), 'holder_party': p.get('mla_party')}
        if r is None:
            gaps['ac_no_result'].append(no)
        else:
            row.update({k: v for k, v in r.items() if k != 'seat'})
            row['result_seat'] = r['seat']
        if not row['holder']:
            gaps['ac_no_holder'].append(no)
        members['ac'][str(no)] = row

    # MPs: one row per Lok Sabha seat, matched by name to the state file's pc field.
    seats = {}
    for p in feats:
        seats.setdefault(p.get('pc'), p.get('mp'))
    pc_by_name = {norm(k): k for k in seats if k}
    pc_by_name.update({norm(a): k for a, k in ALIASES.items() if k in seats})
    used = set()
    for no, r in pc.items():
        name = r['seat']
        key = pc_by_name.get(norm(name))
        if key is None:
            best = max(pc_by_name, key=lambda k: SequenceMatcher(None, k, norm(name)).ratio(), default=None)
            if best and SequenceMatcher(None, best, norm(name)).ratio() >= .85:
                key = pc_by_name[best]
        if key is None or key in used:
            gaps['pc_no_holder'].append(name)
            continue
        used.add(key)
        prev = prev_by_name.get(norm(name))
        row = {'no': no, 'seat': key, 'holder': seats.get(key), 'holder_party': None,
               **{k: v for k, v in r.items() if k != 'seat'}, 'result_seat': name}
        row.update(trend(row, prev))
        members['pc'][key] = row
    for key in seats:
        if key and key not in used:
            gaps['pc_no_result'].append(key)

    for row in list(members['ac'].values()) + list(members['pc'].values()):
        row['band'], row['band_basis'] = band(row)

    for house in ('ac', 'pc'):
        percentiles(members[house], 'winner_pct')
        percentiles(members[house], 'margin_pct')
        percentiles(members[house], 'turnout')

    out = {
        'state': state,
        'retrieved': datetime.date.today().isoformat(),
        'sources': {
            'ac': {'year': src['ac_year'], 'url': 'https://en.wikipedia.org/wiki/' + src['ac_page'].replace(' ', '_'),
                   'basis': 'Wikipedia constituency results table (ECI figures)'},
            'pc': {'year': src['pc_year'], 'url': 'https://en.wikipedia.org/wiki/' + src['pc_page'].replace(' ', '_'),
                   'basis': 'Wikipedia constituency results table (ECI figures)'},
        },
        'method': 'Percentile = share of same-house seats in this state with a lower value (0 = lowest, 100 = highest). '
                  'Metrics: winner vote share, margin (winner % minus runner-up %), turnout. '
                  'Band (label, not a forecast): close = margin under 5 pp; marginal = margin 5 to 10 pp, or the same party '
                  'lost 5 pp or more of vote share since the previous Lok Sabha election; comfortable = otherwise. '
                  'Where no comparable previous share exists (MLAs: the 2017 page has no vote share), the band uses margin only. '
                  'Trend compares the same party, so it is not a candidate record.',
        'sources_prev': {'pc': {'year': src['pc_prev_year'], 'url': 'https://en.wikipedia.org/wiki/' + src['pc_prev_page'].replace(' ', '_')}},
        'counts': {'ac': len(members['ac']), 'pc': len(members['pc'])},
        'gaps': gaps,
        'members': members,
    }
    dest = ROOT / 'places' / 'in' / 'profiles'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f'{state}.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(state, out['counts'], {k: len(v) for k, v in gaps.items()})


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'uttar-pradesh')
