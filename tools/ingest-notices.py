#!/usr/bin/env python3
"""Insert one government notice and its area tags in a single transaction.

Writes to kasa_private.sources (once per portal), documents, notice_details
and document_areas (migration 20261015100000_kasa_notice_areas.sql). The notice
stays unpublished (notice_details.published_at null) until a moderator
publishes it with kasa_admin_set_notice_published.

LGD codes are looked up in kasa_private.areas; a code with no matching area
is an error, nothing is guessed. Load the LGD codes from the official LGD
export first (areas.lgd_code + lgd_source).

Usage (needs SUPABASE_DB_URL, service role / DB owner):
  pip install "psycopg[binary]==3.2.*"
  python3 tools/ingest-notices.py notice.json
notice.json:
  {"title": "...", "url": "https://...", "archive_url": null,
   "start_date": "2026-10-15", "end_date": "2026-11-01",
   "source": {"url": "https://purulia.gov.in/notices", "publisher": "...",
              "title": "...", "source_type": "government", "jurisdiction": "Purulia"},
   "lgd_codes": [{"lgd_code": "<from LGD export>", "match_type": "exact", "confidence": 1.0}]}
"""
import json
import os
import sys

import psycopg

MATCH_TYPES = {"exact", "fuzzy", "inherited", "manual"}


def ingest(conn, notice: dict) -> int:
    src = notice["source"]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """insert into kasa_private.sources (url, publisher, title, source_type, jurisdiction)
                   values (%s, %s, %s, %s, %s)
                   on conflict (url) do update set last_checked_at = now()
                   returning id""",
                (src["url"], src.get("publisher"), src["title"], src["source_type"], src["jurisdiction"]),
            )
            source_id = cur.fetchone()[0]

            cur.execute(
                """insert into kasa_private.documents
                       (source_id, url, title, source_class, document_type, archive_url, rights_review)
                   values (%s, %s, %s, 'official_primary', 'government_notice', %s, %s)
                   returning id""",
                (source_id, notice["url"], notice["title"], notice.get("archive_url"),
                 notice.get("rights_review", "link_only")),
            )
            doc_id = cur.fetchone()[0]

            cur.execute(
                """insert into kasa_private.notice_details (document_id, start_date, end_date)
                   values (%s, %s, %s)""",
                (doc_id, notice.get("start_date") or None, notice.get("end_date") or None),
            )

            for m in notice.get("lgd_codes", []):
                if m.get("match_type", "exact") not in MATCH_TYPES:
                    raise ValueError(f"bad match_type: {m.get('match_type')}")
                cur.execute("select id from kasa_private.areas where lgd_code = %s", (m["lgd_code"],))
                row = cur.fetchone()
                if row is None:
                    raise LookupError(f"no area with lgd_code {m['lgd_code']}; load the LGD export first")
                cur.execute(
                    """insert into kasa_private.document_areas (document_id, area_id, match_type, confidence)
                       values (%s, %s, %s, %s)
                       on conflict (document_id, area_id) do nothing""",
                    (doc_id, row[0], m.get("match_type", "exact"), m.get("confidence", 1.0)),
                )
    return doc_id


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        notice = json.load(f)
    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        print("inserted document id:", ingest(conn, notice))


if __name__ == "__main__":
    main()
