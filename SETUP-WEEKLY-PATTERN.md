# Weekly Pattern Digest

Automatically detect and report civic problem patterns every Monday using pure SQL analysis.

## What It Does

Every Monday at 6am UTC, the digest analyzes last week's reports and detects:

1. **Clusters** — 5+ reports of the same issue type in one ward (suggests contractor failure)
2. **Overdue** — Reports past their SLA deadline by ward (who needs to catch up)
3. **Low Resolution** — Departments with <50% resolution rate this week (need help)
4. **Recurrence** — Same problem re-reported at same spot within 60 days (not fixed)

Each finding links to the map filtered to that specific issue, so moderators can drill down instantly.

## Setup (5 minutes)

### 1. Deploy the edge function

```bash
supabase functions deploy kasa-weekly-pattern
```

### 2. Add environment secrets

In Supabase > Settings > Functions > Secrets:

```
RESEND_API_KEY        [your existing key from kasa-weekly-digest]
PATTERN_DIGEST_TO     [comma-separated email list, optional]
PATTERN_DIGEST_FROM   [from email, default: Parishkar Purulia <onboarding@resend.dev>]
SITE_URL              [default: https://archiboltmusk.github.io/Purulia]
```

**Example:**
```
PATTERN_DIGEST_TO=collector@purulia.gov.in,eo@municipality.local
```

### 3. Apply the database migrations

```bash
supabase db push
```

This creates four SQL functions:
- `kasa_weekly_clusters()` — Find categories with 5+ reports same ward
- `kasa_weekly_overdue()` — Find reports past SLA
- `kasa_weekly_resolution()` — Compare resolution rates by department
- `kasa_weekly_recurrence()` — Find spots where issue keeps re-appearing

And schedules the digest to run Monday 6am UTC.

### 4. (Optional) Test manually

```bash
# In Supabase SQL editor
select http_post(
  'https://YOUR_PROJECT.supabase.co/functions/v1/kasa-weekly-pattern',
  '{}',
  'application/json'
);
```

Or trigger via curl (from your server):
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/kasa-weekly-pattern \
  -H "Authorization: Bearer SUPABASE_ANON_KEY"
```

## What Gets Sent

**To configured recipients** (if `PATTERN_DIGEST_TO` is set):
```
Parishkar Purulia — weekly patterns for Monday, Sep 27

⚠ CLUSTERS (5+ same issue, same ward):
  • 8 garbage reports in Ward 4 this week
    [link to map filtered to Ward 4 garbage]

⏰ OVERDUE (past SLA):
  • 3 reports in Ward 2 past 5-day SLA (oldest: 9 days)
    [link to Ward 2 oldest first]

📉 LOW RESOLUTION:
  • engineering: only 40% of this week's reports resolved (2/5)

🔄 RECURRING ISSUES (same spot, multiple reports):
  • Spot in Ward 5: same drain re-reported 3 times in 60 days
    [link to report]

Action: Click links to filter the map and coordinate with departments.
```

**Preview mode** (if `PATTERN_DIGEST_TO` is empty):
Digest shows findings but only sends to the Parishkar team so you can verify before enabling.

## Cost

- **Zero** — pure SQL queries on data you already have
- ~500ms to run (batched once/week)
- No external API calls beyond email

## Customization

### Change the day/time

Edit `supabase/migrations/20260927000100_kasa_weekly_pattern_schedule.sql`:

```sql
'0 6 * * 1'  -- Currently: Monday 6am UTC
'0 7 * * 1'  -- Change to: Monday 7am UTC
'0 6 * * 0'  -- Change to: Sunday 6am UTC
```

Then run `supabase db push` again.

### Adjust cluster threshold

In `supabase/functions/kasa-weekly-pattern/index.ts`, change the `having count(*) >= 5` to any number:

```typescript
// In kasa_weekly_clusters query:
having count(*) >= 3  -- Now: 3+ reports instead of 5+
```

### Add a custom pattern

Add a new RPC function to `supabase/migrations/20260927000000_kasa_weekly_pattern_functions.sql` and call it from `getPatterns()` in the edge function.

For example, detect "newly broken infrastructure":
```sql
-- Reports with 'broken' or 'damage' that are brand new (< 24h)
select * from reports 
where description ilike '%broken%' or description ilike '%damage%'
  and created_at > now() - interval '1 day'
```

## Troubleshooting

**No email received?**
- Check `RESEND_API_KEY` is set and valid
- Check `PATTERN_DIGEST_TO` is configured (if empty, preview mode sends nowhere)
- Check Supabase function logs (Dashboard > Functions > kasa-weekly-pattern > Logs)

**No patterns found?**
- OK! Means the last 7 days had no clusters, overdue, or recurrences
- The digest still sends with "No notable patterns this week. Reports are flowing normally."

**Wrong time?**
- `pg_cron` runs in UTC. Adjust the cron expression if your team is in a different timezone

## See Also

- `kasa-weekly-digest` — Email municipality ward-by-ward counts
- `kasa-flag-alert` — Notify moderators when reports are flagged
- `analytics.html` — Dashboard showing all metrics
