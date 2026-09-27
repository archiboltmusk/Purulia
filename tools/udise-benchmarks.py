#!/usr/bin/env python3
"""Builds schools-benchmarks.json from the Ministry of Education's UDISE+ 2024-25 booklet.

    python3 -m pip install pymupdf
    curl -o udise.pdf "https://dashboard.udiseplus.gov.in/report2026/static/media/UDISE+2024_25_Booklet_existing.118ba29d4773e6372f72.pdf"
    python3 tools/udise-benchmarks.py udise.pdf schools-benchmarks.json

Every figure is read from the booklet's own tables (the page and column are
recorded next to it), so the schools page never carries a number that is not
in the official report. Shares are computed from the table's school counts:
schools with the facility / total schools, all managements.
"""
import json
import sys

SOURCE = {
    'title': 'UDISE+ 2024-25 (Unified District Information System for Education Plus)',
    'publisher': 'Ministry of Education, Government of India',
    'year': '2024-25',
    'url': 'https://dashboard.udiseplus.gov.in/report2026/static/media/UDISE+2024_25_Booklet_existing.118ba29d4773e6372f72.pdf',
    'note': "Schools' own self-reported data for 2024-25, all managements (government, aided, private and others).",
}

# key, label, booklet page, column index in the extracted row (index 3 is total schools)
SHARES = [
    ('water', 'Working drinking water', 36, 8, 'Table 2.5 (continued), col. 18: Functional Drinking Water'),
    ('girls_toilet', "Working girls' toilet", 35, 9, "Table 2.5, col. 8: Functional Girls' Toilet"),
    ('boys_toilet', "Working boys' toilet", 35, 11, "Table 2.5, col. 10: Functional Boys' Toilet"),
    ('electricity', 'Working electricity', 35, 13, 'Table 2.5, col. 12: Functional Electricity'),
    ('handwash', 'Hand-wash facility', 36, 9, 'Table 2.5 (continued), col. 19: Hand wash facility'),
    ('library', 'Library, book bank or reading corner', 35, 4, 'Table 2.5, col. 3: Library/Book Bank/Reading Corner'),
    ('playground', 'Playground', 35, 5, 'Table 2.5, col. 4: Playground'),
    ('ramp', 'Ramp for children with disabilities', 36, 12, 'Table 2.5 (continued), col. 23: Ramp'),
    ('medical', 'Medical check-up of students last year', 36, 11, 'Table 2.5 (continued), col. 22: Conducting Medical Checkup'),
]
# Pupil-teacher ratio, Table 4.12 (page 63): lower is better.
PTR = [('ptr_primary', 'Pupils per teacher, primary (classes 1-5)', 1, 'Table 4.12, col. 3: PTR Primary'),
       ('ptr_upper', 'Pupils per teacher, upper primary (classes 6-8)', 2, 'Table 4.12, col. 4: PTR Upper Primary')]


def rows(doc, page):
    out = {}
    for tb in doc[page - 1].find_tables().tables:
        for r in tb.extract():
            name = ' '.join((r[0] or r[1] or '').split())
            if name and not name.startswith('(') and any(c and c.strip().replace('.', '').isdigit() for c in r[1:]):
                out[name] = [c.strip() if c else '' for c in r]
    return out


def summarise(key, label, cite, page, values, better):
    states = {k: v for k, v in values.items() if k != 'India'}
    order = sorted(states.items(), key=lambda kv: kv[1], reverse=(better == 'high'))
    wb_rank = [k for k, _ in order].index('West Bengal') + 1
    return {
        'key': key, 'label': label, 'better': better, 'unit': '%' if better == 'high' else 'ratio',
        'cite': cite, 'page': page,
        'india': values['India'], 'west_bengal': values['West Bengal'],
        'best': {'name': order[0][0], 'value': order[0][1]},
        'worst': {'name': order[-1][0], 'value': order[-1][1]},
        'west_bengal_rank': wb_rank, 'of': len(states),
        'states': dict(sorted(states.items())),
    }


def main(path, dest):
    import pymupdf
    doc = pymupdf.open(path)
    out = []
    for key, label, page, col, cite in SHARES:
        vals = {}
        for name, r in rows(doc, page).items():
            total, have = int(r[3]), int(r[col])
            vals[name] = round(100 * have / total, 1)
        out.append(summarise(key, label, cite, page, vals, 'high'))
    ptr = rows(doc, 63)
    for key, label, col, cite in PTR:
        vals = {name: int(r[col]) for name, r in ptr.items() if r[col].isdigit()}
        out.append(summarise(key, label, cite, 63, vals, 'low'))
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump({'source': SOURCE, 'indicators': out}, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
