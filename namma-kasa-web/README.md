# NammaKasa Web Application

Complete civic issue reporting and tracking system built with React + Vite + Supabase.

## Features

✅ **Citizen Reporting**
- Live photo capture with GPS coordinates (no gallery uploads)
- One-time capture tokens prevent photo spoofing
- EXIF GPS verification (100m tolerance)
- Auto-tagging by GBA ward

✅ **Three-Stage Moderation**
- Google Cloud Vision SafeSearch for inappropriate content
- Claude Haiku checks if issue is genuine civic problem
- Duplicate detection (50m radius, 24-hour window)

✅ **Public Map & Analytics**
- Geotagged report clustering
- Ward-wise performance leaderboards
- Time-to-resolution tracking (median)
- Hot spot detection (5+ reports in 30 days)

✅ **Citizen-Verified Resolution**
- Follow-up photo required to mark resolved
- Manual verification before counting as resolved
- Cleanup streak tracking (consecutive days with resolutions)

✅ **Ward Attribution**
- Maps 369 GBA wards to MLAs and MPs (2023/2024 elections)
- Old BBMP reports re-attributed to new GBA wards
- Per-ward speed leaderboards

## Setup

### Installation

\`\`\`bash
npm install
cp .env.example .env.local
# Edit .env.local with Supabase credentials
npm run dev
\`\`\`

## Database Schema

Migration file: \`supabase/migrations/20260924220000_namma_kasa_schema.sql\`

Key tables:
- \`namma_kasa.reports\` - Citizen reports
- \`namma_kasa.wards\` - 369 GBA wards
- \`namma_kasa.hotspots\` - Report clusters
- \`namma_kasa.cleanup_streaks\` - Daily tracking

## Security

✅ Cryptographic photo binding (one-time tokens)
✅ EXIF GPS verification
✅ Evidence validation
✅ Row-level security

## License

CC BY 4.0 - Open data for civic engagement
