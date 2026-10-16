#!/usr/bin/env python3
"""Profile photos for West Bengal MLAs and MPs -> places/leader-photos.json.

Source chain (all public, no key):
  1. en.wikipedia REST summary for the person's article (checked: politician + West Bengal in the lead).
  2. The article's lead image, accepted only when hosted on Wikimedia Commons.
  3. Commons file page: licence (licensetpl_short) and author. Only CC BY / CC BY-SA / CC0 / public domain / GODL-India pass.
Anything else is left out and counted in `missing` with the reason. Nothing is guessed or hotlinked from
third-party sites. Requests are throttled and cached (--cache) so a rerun resumes.

Usage: python3 tools/build-leader-photos.py [--cache DIR] [--only ac|pc] [--limit N]
"""
import argparse, datetime, html, json, os, re, sys, time, unicodedata
import urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEADERS = os.path.join(ROOT, 'places', 'wb_leaders.json')
OUT = os.path.join(ROOT, 'places', 'leader-photos.json')
UA = 'ParishkarBot/1.0 (https://github.com/archiboltmusk/Purulia; civic data, contact via repo issues)'
OK_LICENCE = re.compile(r'\b(CC BY(-SA)?\s?[0-9.]*|CC0|Public domain|PD-[A-Za-z-]+|GODL-India)\b', re.I)
BAD_LICENCE = re.compile(r'fair use|non-free|copyrighted|all rights reserved', re.I)
DELAY = 2.0

class RateLimited(Exception):
    pass

def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower().strip()

def get(url, cache_dir, key):
    path = os.path.join(cache_dir, re.sub(r'[^A-Za-z0-9._-]', '_', key)[:200] + '.txt') if cache_dir else None
    if path and os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, encoding='utf-8') as f:
            return f.read()
    for attempt in range(4):
        time.sleep(DELAY)
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json,text/html'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode('utf-8', 'replace')
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                body = ''
                break
            if e.code == 429 or e.code >= 500:
                wait = int(e.headers.get('Retry-After') or 60 * (attempt + 1))
                print(f'  {e.code} on {key}, waiting {wait}s', file=sys.stderr)
                time.sleep(min(wait, 120))
                continue
            raise
    else:
        raise RateLimited(key)
    if path:
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body)
    return body

def summary(name, cache):
    for title in (name, f'{name} (politician)'):
        slug = urllib.parse.quote(title.replace(' ', '_'))
        raw = get(f'https://en.wikipedia.org/api/rest_v1/page/summary/{slug}', cache, 'sum_' + title)
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if d.get('type') != 'standard':
            continue
        desc = (d.get('description') or '').lower()
        ext = d.get('extract') or ''
        if fold(d.get('title', '')) != fold(name):
            continue
        if 'politician' in desc and 'West Bengal' in ext:
            return d
    return None

def commons_licence(file_name, cache):
    page = 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(file_name)
    raw = get(page, cache, 'file_' + file_name)
    if not raw:
        return None, None
    m = re.search(r'licensetpl(?:_|&#95;)short"[^>]*>([^<]*)', raw)
    lic = html.unescape(m.group(1)).strip() if m else ''
    if not lic:
        m = re.search(r'id="fileinfotpl_lic"[\s\S]{0,400}?<td[^>]*>([\s\S]*?)</td>', raw)
        lic = html.unescape(re.sub(r'<[^>]+>', ' ', m.group(1))).strip() if m else ''
    a = re.search(r'id="fileinfotpl_aut"[\s\S]{0,600}?<td[^>]*>([\s\S]*?)</td>', raw) or re.search(r'>Author</th>\s*<td[^>]*>([\s\S]*?)</td>', raw)
    author = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', a.group(1)))).strip() if a else ''
    return lic, author[:160]

def photo_for(name, cache):
    d = summary(name, cache)
    if not d:
        return None, 'no Wikipedia article with a West Bengal lead'
    img = d.get('originalimage') or {}
    src = urllib.parse.urlsplit(img.get('source') or '').path
    if '/wikipedia/commons/' not in src:
        return None, 'no lead image hosted on Wikimedia Commons' if src else 'no lead image'
    file_name = urllib.parse.unquote(src.rsplit('/', 1)[-1])
    if not file_name:
        return None, 'no lead image hosted on Wikimedia Commons'
    lic, author = commons_licence(file_name, cache)
    if lic is None:
        return None, 'Commons file page not reachable'
    if BAD_LICENCE.search(lic) or not OK_LICENCE.search(lic):
        return None, f'licence not reusable ({lic[:60] or "none stated"})'
    thumb = (d.get('thumbnail') or {}).get('source') or img.get('source')
    return {
        'photo': thumb,
        'file': 'File:' + file_name,
        'page': 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(file_name),
        'article': d.get('content_urls', {}).get('desktop', {}).get('page', ''),
        'licence': lic[:80],
        'author': author,
    }, None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='')
    ap.add_argument('--only', choices=['ac', 'pc'])
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    with open(LEADERS, encoding='utf-8') as f:
        leaders = json.load(f)
    out = {'checked': datetime.date.today().isoformat(),
           'sources': {'articles': 'https://en.wikipedia.org', 'photos': 'https://commons.wikimedia.org'},
           'licences': 'CC BY, CC BY-SA, CC0, public domain or GODL-India (Government Open Data Licence, attribution required), as stated on the Commons file page. Credit and licence are shown on the leader profile.',
           'ac': {}, 'pc': {}, 'missing': {'ac': {}, 'pc': {}}}
    for group in ('ac', 'pc'):
        if args.only and args.only != group:
            continue
        items = list(leaders[group].items())
        if args.limit:
            items = items[:args.limit]
        for n, v in items:
            if v.get('vacant') or not v.get('person'):
                out['missing'][group][n] = 'no person on record'
                continue
            try:
                got, why = photo_for(v['person'], args.cache)
            except RateLimited as e:
                got, why = None, 'not fetched: rate-limited by Wikimedia, rerun to fill'
            if got:
                out[group][n] = got
            else:
                out['missing'][group][n] = why
            print(f"{group}:{n} {v['person']}: {'ok' if got else why}", file=sys.stderr)
    out['counts'] = {g: {'photo': len(out[g]), 'missing': len(out['missing'][g]), 'total': len(leaders[g])} for g in ('ac', 'pc')}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(json.dumps(out['counts']), file=sys.stderr)

if __name__ == '__main__':
    main()
