# Security Policy

## Reporting Security Issues

If you discover a security vulnerability in Parishkar Purulia, please email **grievance@puruliakasa.in** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Do not open a public GitHub issue for security vulnerabilities.

---

## Security Audit (2026-09-24)

A comprehensive security review confirms that **Parishkar Purulia is safe for public access**:

### ✅ Current Code
- No offensive content or illegal activity
- All secrets properly managed (API keys in environment variables, not hardcoded)
- Supabase anon-role keys only (limited permissions)
- Public tokens (WAQI, Turnstile) appropriately scoped
- CSV export protects against formula injection
- Photo analysis uses server-side validation only

### ⚠️ Git History (Historical)
Old commits (pre-2026) contain exposed secrets **not in current code**:
- **Google Cloud Vision API key** (commits a176743, dd016bd) — **ROTATED** ✓
- **Admin passwords** (commits e1eb537, fdca62b) — deprecated, not in use

### 🔄 Required Action: Google Cloud Vision API Key Rotation

The photo-check Edge Function expects `GOOGLE_VISION_API_KEY` via Supabase secrets:

**Step 1: Delete old key in Google Cloud Console**
```
https://console.cloud.google.com/apis/credentials
→ Find API key starting with AIzaSyDs7EgI…
→ Click delete (trash icon)
→ Confirm
```

**Step 2: Create new API key**
```
Same Credentials page
→ + Create Credentials → API Key
→ Copy the new key
```

**Step 3: Update Supabase secret**

Using Supabase CLI:
```bash
supabase secrets set GOOGLE_VISION_API_KEY=<new_key_here>
supabase deploy edge-functions
```

Or manually via dashboard:
```
Supabase → Settings → Edge Functions → Secrets
→ Create secret: GOOGLE_VISION_API_KEY = <new_key>
```

Once deployed, all photo safety checks use the rotated key automatically.

---

## Security Best Practices

### Enabled Protections ✓
- GitHub Secret Scanning (detects exposed credentials in pushes)
- Push Protection (blocks commits containing secret patterns)
- Supabase anon-role isolation (browser cannot modify schema/auth)
- Service-worker caching (offline shell, no sensitive data)
- CSV export restrictions (public data only, formula injection protected)

### Recommendations

1. **Rotate secrets quarterly** — API keys, OAuth tokens
2. **Monitor Supabase logs** — audit photo checks, escalations, reports
3. **Enable 2FA** — on GitHub, Google Cloud, Supabase accounts
4. **Review contributors** — before granting push access
5. **Audit uploads** — photos go through server-side safety checks before storage

---

## Deployment Security

- GitHub Pages (static HTML/JS only, no server-side code)
- Supabase Edge Functions (runs on Deno, isolated runtime)
- Supabase PostgreSQL (row-level security enabled, audit logs)
- Web app progressive enhancement (works offline, no auth required for viewing)

---

## Third-Party Dependencies

All dependencies are public and open-source:
- **MapLibre GL** — open map library (no analytics)
- **Supabase JS SDK** — official Supabase client
- **Web Push API** — browser standard (optional, requires user opt-in)

---

## Public Data & Licensing

All report content (text, location, category, status) is published under **CC BY 4.0**:
- Anyone can use the data freely
- Must credit Parishkar Purulia
- Photos remain under stricter control (not in CC BY export)

See `terms.html` for full licence terms.

---

**Last Updated:** 2026-09-24
**Review Schedule:** Quarterly
**Contact:** grievance@puruliakasa.in
