# Parishkar Purulia: Features and Methodology Guide

**For contributors, maintainers, and people forking this project**

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Core Features](#core-features)
3. [Architecture and Methodology](#architecture-and-methodology)
4. [Technology Stack](#technology-stack)
5. [Database Schema and Patterns](#database-schema-and-patterns)
6. [Coding Standards](#coding-standards)
7. [Deployment Pipeline](#deployment-pipeline)
8. [Adding Features](#adding-features)
9. [Testing Strategy](#testing-strategy)
10. [Common Patterns](#common-patterns)

---

## Project Overview

**Parishkar Purulia** is a civic accountability app that enables residents to report problems (garbage, drains, roads, streetlights, water, illegal activity) with photos and location, and verifies fixes through community confirmation.

### Key Values

- **Evidence-based**: Every fix must be verified on-site by neighbours
- **Transparent**: All reports are public; fixes are recorded
- **Accessible**: Works with limited connectivity; supports 3+ languages
- **Maintainable**: Clear code structure for long-term community ownership
- **Deployable**: Can be adapted for any Indian town in hours

---

## Core Features

### Tier 1: Reporting and Verification

| Feature | Status | Description |
|---------|--------|-------------|
| **Report a problem** | ✅ Live | Photo + location + 10 categories (garbage, drain, road, streetlight, water, illegal mining, encroachment, illegal construction, illegal other, missing) |
| **Live SLA clock** | ✅ Live | Critical (1d), Severe (3d), Minor (7d); shows "Due in Xh" or "Xh overdue" |
| **Duplicate detection** | ✅ Live | Same category within 40m and time window auto-linked; shows in history |
| **Recurrence tracking** | ✅ Live | Same spot re-reported after fix is marked as "Didn't last" |
| **Community verification** | ✅ Live | Min 2 people from different networks confirm cleanup on-site with photos |
| **Photo checks (Vision AI)** | ✅ Live | Automatic scoring: garbage level, unsafe content, photo authenticity |
| **Fast-lane cleanup** | ✅ Live | If photo shows clean, 1 person can confirm; auto-closes after 3d if undisputed |
| **Moderator review** | ✅ Live | Manual approval for flagged/illegal reports; photo rejection; claim/vote voiding |
| **Dispute path** | ✅ Live | 2 on-site disputes reject fake cleanup; claimant gets strike; 3 strikes = blocked |

### Tier 2: Community and Insights

| Feature | Status | Description |
|---------|--------|-------------|
| **Ward accountability** | ✅ Live | Weekly digest of fixes by ward; councillor card with contact |
| **Hotspot detection** | ✅ Live | Places with 3+ reports in 90 days; busiest first |
| **Heatmap view** | ✅ Live | Problems shown as glow; critical > minor |
| **Analytics page** | ✅ Live | District-wide patterns; overdue reports; longest-waiting; forest loss link |
| **Public record** | ✅ Live | Daily tamper-evident JSON of all public data in `/record/` |
| **Weekly email digest** | ✅ Live | Monday morning: ward patterns, clusters, overdue, recurring issues |
| **Quiet subscribe** | ✅ Live | Opt-in; one-click unsubscribe in email |

### Tier 3: Schools (Government Accountability)

| Feature | Status | Description |
|---------|--------|-------------|
| **Check a school** | ✅ Live | 6 questions: water, toilets, boundary, electricity, mid-meal kitchen, building |
| **School map** | ✅ Live | Blocks shaded by % checked; pins show score (green/amber/red) or grey (unchecked) |
| **Nearby schools** | ✅ Live | Shows block and schools near you; list of all unchecked |
| **Fix school pins** | ✅ Live | Stand there, drag to gate, confirm; 150m constraint; follows latest visitors |
| **RTI drafts** | ✅ Live | Ready-to-send RTI to Samagra Shiksha office for any school with problems |
| **Vidyanjali link** | ✅ Live | Offer help on volunteer teaching/infrastructure |
| **4,040 schools loaded** | ✅ Live | All government-listed schools by block, panchayat, village |

### Tier 4: Waste and Toilets

| Feature | Status | Description |
|---------|--------|-------------|
| **Public toilet reporting** | ✅ Live | Report locked, dry or unclean toilets |
| **Toilet map** | ✅ Live | Every reported toilet with status |
| **Dumping ground map** | ✅ Live | Report where waste is unloaded; shows count of reporters |
| **Waste flow explainer** | ✅ Live | 5 links in waste chain; what's published; RTI draft for missing info |

### Tier 5: Adoption and Ownership

| Feature | Status | Description |
|---------|--------|-------------|
| **Adopt a spot** | ✅ Live | Shop/school/family pledges care; shows "clean" or # of open problems within 50m |
| **Adopted spots page** | ✅ Live | List of all adoptions with current status |
| **Notification option** | ✅ Live | "Tell me when it's fixed" push notification to phone with after photo |

### Tier 6: Accessibility and Metadata

| Feature | Status | Description |
|---------|--------|-------------|
| **Language support** | ✅ Live | Bengali, Hindi, English; stored with every report |
| **Voice typing** | ✅ Live | Speak in your language; phone converts to text for description |
| **Written addresses** | ✅ Live | Nearest road/place from OpenStreetMap in reports and RTI text |
| **Photo metadata** | ✅ Live | Capture time (flag old photos), GPS location, AI markers, camera source |
| **Live camera option** | ✅ Live | Require live-camera cleanup photos (not gallery) when evidence matters most |
| **Photo expiry** | ✅ Live | After 90 days, old problem photos shrink; before/after stay forever |
| **Map picture fallback** | ✅ Live | If map service slow, shows message instead of blank |

### Tier 7: Admin and Moderation

| Feature | Status | Description |
|---------|--------|-------------|
| **Admin sign-in** | ✅ Live | Email + time-limited magic link via Supabase |
| **Moderation queue** | ✅ Live | Show pending claims by vote count; each claim shows all votes + metadata |
| **Approve/hide/review** | ✅ Live | Illegal reports held for approval; abusive/spam hidden; photo issues flagged |
| **Vote voiding** | ✅ Live | Mark fake vote with public reason; removes from count |
| **Claim rejection** | ✅ Live | Fake cleanup thrown out; claimant gets strike |
| **Vote clearing** | ✅ Live | Held photos cleared by moderator with reason; counts toward quorum |
| **Claim clearing** | ✅ Live | Held cleanup claim cleared; resolves report; shows claim_reviewed_at |
| **Admin queue filtering** | ✅ Live | Tabs for waiting, hidden, kept; search by report ID or address |
| **Report deletion** | ✅ Live | Admin can delete exact repeats with reason; logged in deletion audit |
| **Public note** | ✅ Live | Moderator adds note that shows on report history |
| **Repeat detection** | ✅ Live | Moderators see pairs and choose: same problem, different problem, or delete repeat photo |

---

## Architecture and Methodology

### Design Philosophy

1. **Single Responsibility**: Each component (view, function, test) does one thing
2. **Public by Default**: All data is public unless explicitly private
3. **Tamper-Proof**: Changes logged; deletes tracked; evidence permanent
4. **Evidence-First**: Decisions require photos + location, not just claims
5. **Scalable Design**: Paths clear for expanding to 100+ towns
6. **Idempotent Migrations**: Every database change can be re-run safely

### Data Flow

```
Frontend (kasa.js)
    ↓
Supabase RPC Functions (security definer)
    ↓
PostgreSQL with RLS
    ↓
Public View (kasa_public_reports)
    ↓
Frontend Display + API responses
```

### Key Principles

**RLS (Row-Level Security)**
- No direct table access from frontend
- All writes through RPC functions marked `security definer`
- Functions check `request.jwt.claim.sub` (user ID) and `request.headers` (IP hash)
- Admin functions callable only by users in `public.admins` table

**Modularity**
- Each feature has a dedicated migration file
- Views are dropped/recreated or replaced only when absolutely necessary
- Schema changes use "if not exists" for safe re-runs
- Tests verify both new project and legacy-shaped DB schema

**Naming**
- Public views: `kasa_public_*` (e.g., `kasa_public_reports`)
- Private tables: `kasa_private.*` (e.g., `kasa_private.claims`)
- Public functions: `kasa_*` (e.g., `kasa_create_report`)
- User-friendly: Reports are called "reports", not "tickets"

---

## Technology Stack

### Frontend
- **Language**: Vanilla JavaScript (no frameworks)
- **Styles**: CSS3 with custom properties
- **Maps**: Leaflet.js (open-source, no API key needed)
- **Fonts**: EB Garamond + DM Mono
- **Storage**: Supabase (photos) + localStorage (user prefs)
- **Connectivity**: Works offline; syncs when back online

### Backend
- **Database**: PostgreSQL 16 (Supabase managed)
- **Functions**: PL/pgSQL (server-side business logic)
- **Auth**: Supabase Magic Links (email-based, no passwords)
- **Storage**: Supabase Storage (S3-compatible)
- **Photo Processing**: Vision AI (garbage score, face detection, NSFW)
- **Push Notifications**: Web Push API
- **Workflow**: GitHub Actions (scheduled jobs, migrations)

### Deployment
- **Frontend**: GitHub Pages (static files from `main` branch)
- **Database**: Supabase (managed Postgres)
- **CI/CD**: GitHub Actions (database tests, syntax checks, page deployments)
- **Staging**: Supabase Preview Branches (SQL changes tested before merge)

---

## Database Schema and Patterns

### Core Tables

#### `public.reports`
```sql
id              uuid primary key
lat, lng        float (with accuracy_m validation)
category        text (enum: garbage, drain, road, etc.)
severity        text (minor, severe, critical)
status          text (open, claimed, resolved)
description     text (user-entered, max 500 chars)
landmark        text (max 140 chars)
photo_url       text (Supabase URL)
photo_path      text (storage path for deletion)
upvotes         int (neighbors who saw this too)
flags           int (users who reported as wrong)
seen_on_site    int (GPS-verified upvotes)
sla_days        int (7 default; overridable by category)
parent_report_id uuid (for duplicates)
is_duplicate    bool (true if joined to earlier report)
recurrence_count int (times same spot re-reported after fix)
resolved_at     timestamptz (when marked fixed)
resolved_photo_url text (evidence of fix)
resolution_method text (community, legacy_unverified, admin)
moderation_status text (approved, flagged, review, hidden)
moderation_labels jsonb (AI: garbage_score, labels, etc.)
claim_id        uuid (current open claim, if any)
ward_no         int (1-23 in Purulia)
reporter_hash   text (SHA256 of user_id + IP salt; anon)
user_id         uuid (user who filed; not public)
client_id       text (offline retry dedup)
created_at      timestamptz
boundary_type   text (municipality or gram_panchayat for routing)
```

#### `kasa_private.claims`
```sql
id              uuid primary key
report_id       uuid (which problem is being fixed)
user_id         uuid (who is claiming to fix it)
photo_path      text (evidence of completed fix)
status          text (pending, accepted, rejected, expired)
verify_count    int (how many neighbors confirmed)
dispute_count   int (how many said "still dirty")
quorum_reached_at timestamptz (when 2+ networks confirmed)
final_after     timestamptz (challenge window end)
needs_review    bool (GPS mismatch or held vote)
reviewed_at     timestamptz (when moderator cleared hold)
created_at      timestamptz
distance_m      float (claimant distance from report)
decided_reason  text (what ended it: photo_not_reviewed, expired, etc.)
```

#### `kasa_private.votes`
```sql
id              uuid primary key
claim_id        uuid (which claim is being confirmed/disputed)
voter_id        uuid (who is voting)
vote            text (verify, dispute)
ip_hash         text (network grouping; no IPs stored)
photo_path      text (evidence of vote)
accuracy_m      float (GPS precision)
needs_review    bool (if GPS or metadata flagged it)
distance_m      float (distance from report)
created_at      timestamptz
```

#### `kasa_private.profiles`
```sql
user_id         uuid primary key
strikes         int (3 = banned from claiming; reset yearly)
```

#### `kasa_private.photo_checks`
```sql
photo_path      text (foreign key to storage)
garbage_score   float (0–1; >0.25 = dirty)
labels          jsonb (category tags from Vision)
dhash           text (perceptual hash for duplication)
unsafe          bool (NSFW or face detection)
sha256          text (byte-identical duplication check)
```

### Public Views

#### `public.kasa_public_reports`
- Shows all reports in "approved" or "flagged" moderation status
- Joins with current claim + votes metadata
- Includes SLA days, GPS verified flag, ward accountability
- **Key columns**: all report fields EXCEPT user_id, reporter_hash, client_id, ip_hash
- **Permissions**: SELECT for anon and authenticated

#### `public.kasa_public_events`
- Tamper-evident log of every action (reported, seen, verified, resolved, etc.)
- **actor_tag**: 6-char pseudonym (not user_id)
- **detail**: JSON with context (GPS accuracy, AI scores, claimant strikes, etc.)
- Kept forever; never deleted

#### `public.kasa_public_replies`
```sql
id              uuid
report_id       uuid
responder_name  text (e.g., "Councillor 5")
responder_role  text (e.g., "Ward 5 Councillor")
body            text (official response)
verified_note   text (e.g., "Email from councillor, 25 Sep")
created_at      timestamptz
```

### Migration Patterns

**Safe View Updates**
```sql
-- ✅ Use this pattern for recent changes:
create or replace view public.kasa_public_reports as
select ... from public.reports r
left join kasa_private.claims c on c.id = r.claim_id
...;

-- ❌ Avoid this pattern (dependency issues):
drop view if exists public.kasa_public_reports;
create view public.kasa_public_reports as ...;
```

**Idempotent Constraints**
```sql
do $$ begin
  alter table public.reports add constraint kasa_reports_boundary_type_chk
    check (boundary_type is null or boundary_type in ('municipality', 'gram_panchayat'));
exception when duplicate_object then null;
end $$;
```

**Idempotent Indexes**
```sql
create index if not exists kasa_reports_boundary_type_idx on public.reports (boundary_type);
```

**Idempotent Functions**
```sql
create or replace function public.kasa_create_report(...) returns jsonb as $$
  -- Body (always safe to re-create)
end $$;
```

---

## Coding Standards

### JavaScript / Frontend

**File Organization**
- `kasa.js` - Main app (report flow, map, submission)
- `kasa-i18n.js` - Translations (Bengali, Hindi, English)
- `kasa-photo-meta.js` - Photo metadata capture (EXIF, GPS, camera)
- `admin.js` - Moderation interface
- `config.js` - Town-specific config (VAPID, coordinates, categories)
- `city.js` - Town customization (ward list, councillor cards, schools)

**Naming**
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Private functions: Prefix with `_` (e.g., `_validatePhoto()`)
- DOM IDs: `kebab-case` (e.g., `id="report-form"`)

**Patterns**
```javascript
// Async operations with error handling
async function submitReport(draft) {
  try {
    const result = await supabase.rpc('kasa_create_report', {
      p_category: draft.category,
      p_lat: draft.lat,
      // ... params
    });
    return result.data;
  } catch (error) {
    console.error('Report failed:', error);
    showErrorUI(error.message);
  }
}

// Event delegation
document.addEventListener('click', (e) => {
  if (e.target.matches('.report-btn')) {
    startReport();
  }
});

// State management
const state = {
  reportInProgress: false,
  currentLocation: null,
  selectedCategory: null,
};
```

**Comments**
- Only explain WHY, not WHAT
- No docstrings for obvious functions
- Reference related database functions

```javascript
// ✅ Good
// Position is validated client-side but double-checked server
// because map bounds are user-configurable
validateLocation(lat, lng);

// ❌ Bad
// Check if location is valid
if (lat < minLat) { /* ... */ }
```

### PostgreSQL / Backend

**Naming**
- Tables: `singular_nouns` (e.g., `reports` not `report_list`)
- Columns: `snake_case_short` (e.g., `created_at` not `creation_timestamp`)
- Functions: `kasa_what_action(params)` (e.g., `kasa_create_report()`)
- Variables: `v_name`, `p_name` (locals and parameters)

**RLS Policy Pattern**
```sql
-- Public can SELECT but not UPDATE/DELETE
do $$
begin
  create policy "public_select_reports"
    on public.reports
    for select
    to anon, authenticated
    using (moderation_status in ('approved', 'flagged'));
exception when duplicate_object then null;
end $$;

-- Only security definer functions INSERT
-- (no direct user INSERT via RLS)
```

**Function Pattern**
```sql
create or replace function public.kasa_create_report(
  p_category text,
  p_lat double precision,
  p_lng double precision,
  -- ... params
  p_boundary_type text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();  -- current user
  v_new public.reports;
  v_url text;
begin
  -- Validation
  if p_category is null or p_category not in ('garbage', 'drain', ...) then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose what kind of problem.');
  end if;

  -- Main operation
  insert into public.reports (lat, lng, category, ...)
  values (p_lat, p_lng, p_category, ...)
  returning * into v_new;

  -- Side effects
  perform kasa_private.add_event(v_new.id::text, 'reported', me.user_id, ...);

  -- Response
  return jsonb_build_object('id', v_new.id, 'moderation_status', v_new.moderation_status);
end $$;
```

---

## Deployment Pipeline

### Branch Workflow

1. **Feature Branch**: Create from `main` (e.g., `claude/my-feature-xyz`)
2. **Development**: Commit regularly with clear messages
3. **Push**: `git push -u origin claude/my-feature-xyz`
4. **PR**: GitHub creates preview deployment automatically
5. **Staging Test**: Supabase Preview Branch applies migrations
6. **Merge**: Once all checks pass, merge to `main`
7. **Production**: GitHub Pages and Supabase production both update

### GitHub Actions Workflows

#### `.github/workflows/kasa-tests.yml` (On every push/PR)
```
database-rules (PostgreSQL schema test)
  → Applies all migrations to fresh DB + legacy-shaped DB
  → Runs python test suite (loopholes, security, schema)
  → Validates: RLS, public columns, function signatures

frontend (JavaScript syntax)
  → node --check on kasa.js, admin.js, etc.
  → Photo metadata test suite (3 time zones)
  → Photo fingerprint + Vision scoring
  → Ward boundary validation

workers (Cloudflare)
  → Previews app on your branch
  → Clickable link in PR
```

#### `.github/workflows/github-pages.yml` (Merged to main)
```
Build static site
  → HTML, JS, CSS only (no Next.js/build step)
  → Deploy to GitHub Pages
  → Site live at archiboltmusk.github.io/Purulia/
```

#### `.github/workflows/public-record.yml` (Scheduled 1am UTC daily)
```
Fetch all public data
  → Query kasa_public_reports, kasa_public_events, etc.
  → Create JSON with git commit hash of schema
  → Commit to record/ folder
  → Append-only; never overwrite or delete
```

### Database Migrations

**Numbering**: `YYYYMMDDHHMM_description.sql`

**Structure**:
```sql
-- Description comment

begin;  -- or standalone if no transactions needed

-- Operation 1
alter table public.reports add column if not exists boundary_type text;

-- Operation 2
do $$ begin
  -- Idempotent constraint creation
  alter table public.reports add constraint kasa_boundary_type_chk
    check (boundary_type is null or boundary_type in ('municipality', 'gram_panchayat'));
exception when duplicate_object then null;
end $$;

-- Operation 3
create index if not exists kasa_reports_boundary_type_idx on public.reports (boundary_type);

-- Operation 4 - View updates
create or replace view public.kasa_public_reports as
select ... ;

revoke all on public.kasa_public_reports from public, anon, authenticated;
grant select on public.kasa_public_reports to anon, authenticated;

notify pgrst, 'reload schema';  -- Tell PostgREST to reload

commit;
```

**Testing**:
- Migrations run twice (idempotency check)
- Both fresh DB and legacy-schema DB tested
- Test verifies schema matches expectations

---

## Adding Features

### Typical Feature Workflow

#### 1. Define the Data Structure
```sql
-- supabase/migrations/20260927HHMM_add_feature_name.sql
create table if not exists public.feature_records (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id),
  user_id uuid,  -- NOT public; stored for logging
  created_at timestamptz default now()
);

-- RLS: only security-definer functions can insert
alter table public.feature_records enable row level security;

do $$
begin
  create policy "no_direct_insert" on public.feature_records
    for insert to authenticated with check (false);
exception when duplicate_object then null;
end $$;
```

#### 2. Create the RPC Function
```sql
create or replace function public.kasa_do_feature(
  p_report_id text,
  p_data jsonb default null
) returns jsonb language plpgsql security definer as $$
declare
  me kasa_private.profiles := kasa_private.me();
begin
  -- Insert and log
  insert into public.feature_records (report_id, user_id)
  values (p_report_id::uuid, me.user_id);

  perform kasa_private.add_event(p_report_id, 'feature_action', me.user_id, ...);
  
  return jsonb_build_object('success', true);
end $$;
```

#### 3. Update the Public View (if needed)
```sql
create or replace view public.kasa_public_reports as
select ..., (feature_count > 0) as has_feature
from public.reports r
left join (select report_id, count(*) as feature_count from public.feature_records group by 1) f
  on f.report_id = r.id
...;
```

#### 4. Call from Frontend
```javascript
async function doFeature(reportId) {
  const result = await supabase.rpc('kasa_do_feature', {
    p_report_id: reportId,
    p_data: { whatever: 'data' }
  });
  return result.data;
}
```

#### 5. Update `kasa.js` PUBLIC_REPORT_COLUMNS
```javascript
const PUBLIC_REPORT_COLUMNS = 'id,created_at,...,has_feature';
```

#### 6. Test
```bash
cd supabase/tests && python3 test_migration.py "host=localhost port=5432 dbname=postgres user=postgres"
```

---

## Testing Strategy

### Database Tests

**File**: `supabase/tests/test_migration.py`

**What It Tests**:
1. **Loopholes**: RLS policies prevent unauthorized access
2. **Schema**: Public columns match expected list
3. **Functions**: Correct permissions and signatures
4. **Evidence Trail**: Events are logged correctly
5. **Scenarios**: Full user workflows (report → verify → resolve)

**How to Run**:
```bash
# Install deps
pip install "psycopg[binary]==3.2.*"

# Run tests
bash supabase/tests/run.sh
```

**Idempotency**:
- Migrations run twice to ensure they're re-runnable
- Both fresh and legacy-schema databases tested
- If a migration fails, the test suite fails too

### Frontend Tests

**Syntax Check**:
```bash
node --check kasa.js
node --check admin.js
```

**Photo Metadata Tests**:
```bash
npm install imagescript jpeg-js
node tests/kasa_photo_meta.test.mjs
```

---

## Common Patterns

### Pattern 1: User-Generated Report

```
Frontend: User fills form → Clicks submit → Calls kasa_create_report()
Database: Function validates → Inserts into reports → Returns ID
Event: add_event() logs "reported" with GPS accuracy
Response: Frontend shows report on map
```

### Pattern 2: Moderator Approval

```
Frontend: Admin opens report marked "flagged"
Database: Call kasa_admin_moderate(report_id, 'approve')
Check: User must be in public.admins table
Event: "moderated" event logged with reason
Response: Report becomes visible on public map
```

### Pattern 3: Duplicate Detection

```
Frontend: User files report 15m from earlier garbage report
Database: kasa_create_report() finds parent via:
  - Same category
  - Distance ≤ 40m
  - Within duplicate_hours window
  - Not already is_duplicate
Response: New report ID points to parent; upvotes parent instead
```

### Pattern 4: Verification Quorum

```
Frontend: First voter confirms cleanup with photo from spot
Database: kasa_vote_claim(claim_id, 'verify') inserts vote
Check: Validates GPS accuracy, network IP grouping, account age
Response: Show other voters' info and network count

Once 2+ networks confirmed:
Database: quorum_reached_at timestamp set; challenge window opens
Response: "Waiting for community final verdict" message
After 12+ hours with no disputes:
Database: kasa_finalize_due() marks report resolved
Response: "Fixed by community on [date]" with before/after photos
```

### Pattern 5: Language-Aware Queries

```javascript
// Frontend stores selected language
const lang = localStorage.getItem('lang') || 'en';  // en, bn, hi

// Sends with every report
await supabase.rpc('kasa_create_report', {
  // ... params ...
  p_language: lang  // Stored for future translations
});
```

### Pattern 6: Offline-First Submission

```javascript
// User is offline; photo is stored locally with client_id
const clientId = crypto.randomUUID();
draft.clientId = clientId;
saveDraftLocally(draft);

// When online, retry
kasa_create_report(..., p_client_id: clientId)
  // If same client_id exists, returns existing report (no duplicate)
```

---

## Scaling to Other Towns

### Minimum Changes for Town X

1. **Update `config.js`**:
   ```javascript
   const TOWN_CONFIG = {
     name: 'Town Name',
     center: [lat, lng],
     bounds: { minLat, minLng, maxLat, maxLng },
     wards: 20,  // or 0 if no wards
     vapidPublicKey: 'YOUR_KEY'
   };
   ```

2. **Update `city.js`**:
   ```javascript
   const WARD_LIST = [
     { no: 1, name: 'Ward Name', councillor: 'Name', phone: '...' },
     // ...
   ];

   const SCHOOLS = [];  // Load from local source via migration
   ```

3. **Create new Supabase project** (or new branch)
   - Run all migrations
   - Load town-specific master data (wards, schools, boundaries)

4. **Deploy to your domain** via GitHub Pages or static host

5. **Customize categories** if needed
   ```javascript
   const CATEGORIES = {
     garbage: { emoji: '♻️', label: 'Garbage', ... },
     // ... add town-specific types
   };
   ```

---

## Contributing Guidelines

### Before You Start

1. Read this file completely
2. Check `/record/README.md` for public data structure
3. Look at recent PRs to match code style
4. File an issue first if it's a large feature

### Commit Message Format

```
verb: Short description

Optional longer explanation of why this change matters.
Keep each line under 80 chars.
```

Examples:
- `fix: ward accountability showing wrong councillor number`
- `feat: Boundary-type routing for municipality vs. gram panchayat`
- `refactor: Simplify vote aggregation query`
- `docs: Explain photo metadata capture flow`

### PR Checklist

- [ ] Tests pass (`database-rules`, `frontend`, syntax checks)
- [ ] No `console.log()` left in code
- [ ] Database changes are idempotent
- [ ] Public columns match test expectations
- [ ] Changelog entry added (if user-visible)
- [ ] Works in Bengali, Hindi, English
- [ ] No hardcoded town names or coordinates (use `config.js`)

### Code Review Expectations

- **Schema changes**: Verify idempotency and backward compatibility
- **RLS policies**: Check that access is minimally granted
- **Functions**: Ensure error messages are user-friendly
- **Views**: Confirm no sensitive data is exposed
- **Performance**: Watch for N+1 queries; index new filters

---

## Performance Targets

- **Map load**: <2s over 3G
- **Report submission**: <1s (local validation), <3s (server round-trip)
- **Vote confirmation**: <2s
- **Moderator queue**: <3s to load 50 items
- **Photo upload**: Depends on size; auto-compressed to <500KB

---

## Security Model

### Public Data
- All reports in "approved" or "flagged" status
- All events with pseudonymous actor tags
- All replies from officials

### Private Data (Never Published)
- User IDs (used only internally)
- IP addresses (only IP hash for network grouping)
- Reporter hashes (prevent tracing individuals)
- Email addresses
- Photo EXIF with precise location (only rounded in database)

### Admin-Only Access
- Raw reporter identities (for follow-up if needed)
- Raw IP logs (for abuse investigation)
- Vote counts before quorum (shows live state)
- Unmoderated flagged/review reports

---

## Troubleshooting

### "Test passes locally but fails in CI"
Check: Database version mismatch. CI uses PostgreSQL 16; ensure your local is too.

### "Migration fails silently"
Check: Run with error output: `psql -U postgres -f migration.sql -d testdb` (no redirect)

### "RLS policy not working"
Check: Function must be marked `security definer`. Role must be `authenticated` or `anon`, not `postgres`.

### "Photos not showing up"
Check: Supabase Storage bucket policies allow anon read. Check CORS headers.

### "Vote doesn't count toward quorum"
Check: Voter must be 60+ days old, different IP /24, <300m from report. Check admin queue for "held" votes.

---

## License

This project is public and available for forking. Please credit original authors and maintain the evidence-first principle in your own deployments.

**For questions**: Open an issue on GitHub.

---

*Last updated: 27 September 2026*
*Maintained by: Parishkar team*
*For: Civic accountability in Purulia and beyond*
