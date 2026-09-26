# Community Digest Subscriptions

Residents can subscribe to the weekly civic pattern digest via email. Every Monday, they get an analysis of what's being reported, what's stuck, and what patterns matter in Purulia.

## Features

- **Self-service signup** — No admin work. Residents enter their email at `/digest-subscribe.html`
- **Live subscriber counter** — Shows how many people are subscribed (refreshes every 30 seconds)
- **One-click unsubscribe** — Each email includes an unsubscribe link
- **No manual management** — Automatic opt-in/opt-out via database

## Setup (2 steps)

### 1. Apply the database migration

```bash
supabase db push
```

This creates:
- `public.digest_subscribers` table (stores emails and unsubscribe tokens)
- Three public RPCs:
  - `kasa_digest_subscribe(email)` — opt in
  - `kasa_digest_subscriber_count()` — get count (public, read-only)
  - `kasa_digest_unsubscribe(token)` — opt out (via email link)

### 2. Deploy edge functions

```bash
supabase functions deploy kasa-weekly-pattern
supabase functions deploy kasa-unsubscribe
```

### 3. Publish the subscription page

The page `/digest-subscribe.html` is ready to use. Link to it from:
- Homepage footer
- Analytics page (`analytics.html`)
- Civic digest page (`digest.html`)
- Any email footer

```html
<a href="/digest-subscribe.html">Subscribe to weekly digest →</a>
```

## How It Works

### Signup Flow

1. User visits `/digest-subscribe.html`
2. Enters their email → clicks "Get Weekly Digest"
3. JavaScript calls `kasa_digest_subscribe(email)`
4. Database generates unique unsubscribe token
5. Subscriber count updates instantly
6. Confirmation message displays

### Weekly Send

Each Monday 6:30am UTC:
1. `kasa-weekly-pattern` function runs
2. Fetches patterns from last week (clusters, overdue, recurrence, low resolution)
3. Calls `kasa_private.digest_subscribers_for_send()` to get all active subscribers
4. Generates email with personalized unsubscribe link
5. Sends individual email to each subscriber + officials (if configured)

### Unsubscribe Flow

1. Subscriber clicks link in email: `${SITE}/kasa-unsubscribe?token=...`
2. `kasa-unsubscribe` function validates token
3. Database sets `is_active = false`
4. Confirmation page shows: "You've been unsubscribed"
5. User can re-subscribe anytime at `/digest-subscribe.html`

## Customization

### Change subscription page styling

Edit `digest-subscribe.html` `<style>` section. Variables:
- `--amber` — primary color (links, buttons)
- `--cream` — text
- `--border` — lines
- `--green`, `--red` — success/error messages

### Add to another page

Copy the form HTML from `digest-subscribe.html` and the `<script>` section to any page. Requires:
- Supabase client loaded: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
- `window.KASA_CONFIG` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (from `city.js`)

### Change unsubscribe page styling

Edit `supabase/functions/kasa-unsubscribe/index.ts` — the `<style>` section.

### Adjust cluster threshold

The digest shows clusters of 5+ reports. To change:

Edit `supabase/migrations/20260927000000_kasa_weekly_pattern_functions.sql`:
```sql
having count(*) >= 3  -- Was 5, now 3+
```

## Database Schema

```sql
create table public.digest_subscribers (
  id uuid primary key,
  email text unique,              -- Lowercase, trimmed
  subscribed_at timestamptz,      -- When they signed up
  last_sent_at timestamptz,       -- When they last got an email
  unsubscribe_token text unique,  -- 64-char hex, used in email link
  is_active boolean,              -- false = unsubscribed
  created_at timestamptz,
  updated_at timestamptz
);
```

## Monitoring

### Check subscription growth

```sql
-- How many active subscribers?
select count(*) from public.digest_subscribers where is_active;

-- When did they sign up?
select 
  date_trunc('day', subscribed_at)::date as day,
  count(*) as new_subscribers
from public.digest_subscribers
group by day
order by day desc;

-- Who unsubscribed?
select email, updated_at from public.digest_subscribers 
where is_active = false
order by updated_at desc;
```

### Test the full flow

1. Subscribe via `digest-subscribe.html`
2. Trigger the digest manually (in Supabase SQL editor or via curl)
3. Check your email for the digest + unsubscribe link
4. Click unsubscribe link, verify it works

## Cost

- **Database:** Minimal — one table, ~100 bytes per subscriber
- **Email:** Paid via Resend (same as existing digests)
- **Automation:** Zero — pg_cron + Edge Function (same as weekly pattern)

## Security

- Emails stored in `public.digest_subscribers` (visible but read-only to browser)
- RLS policies prevent tampering (users can only insert, read counts, or unsubscribe with token)
- Unsubscribe tokens are 256-bit random (32 bytes hex)
- No passwords or sensitive data stored

## Related

- `SETUP-WEEKLY-PATTERN.md` — Pattern digest (AI/SQL analysis)
- `kasa.html` — Civic report map
- `analytics.html` — Dashboard
