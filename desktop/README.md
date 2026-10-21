# Parishkar desktop (macOS + Linux)

Tauri 2 window over the live site (`https://archiboltmusk.github.io/Purulia/kasa.html`). Every page, filter, case file and the moderator screens (`admin.html`, `partner.html`) run the site's own code against the same Supabase rules, so nothing is duplicated and nothing drifts. Not published to the website (excluded in `github-pages.yml` and `.assetsignore`).

Why Tauri, not Electron: it uses the system web view, so the app is about 2 MB (Electron ships Chromium, 100 MB+), starts faster and gets OS security updates. Same tool as the owner's `harbor` repo.

## What it does

- Starts on `offline/index.html`, which waits for a connection and then opens the report map. No connection = "Try again" (and it retries by itself when the network returns).
- Links to the site's own hosts stay in the window; every other link (official portals, Wikipedia, WhatsApp, `tel:`, `mailto:`) opens in the system browser. List: `is_site` in `src-tauri/src/main.rs`.
- Camera and location are allowed only for the site's pages; microphone, screen capture and the rest are refused. A desktop rarely has real GPS, so the site's accuracy check will usually stop a report from being filed here; reporting stays a phone job (`mobile/`).
- Downloads (calendar `.ics`, CSV, GPX, case cover PNG) save to the Downloads folder.
- Window size and position are remembered. No tracking, no analytics, no background location; the app adds no data source of its own.

## Run it

```bash
cd desktop
npm ci
npx tauri dev          # Linux needs: libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev libssl-dev
npx tauri build        # .dmg on a Mac, .AppImage/.deb on Linux
cd src-tauri && cargo test
```

## Download builds

`.github/workflows/desktop-build.yml` builds on every change to `desktop/`. On `main` it publishes a GitHub Release `desktop-build-<n>` with a universal macOS `.dmg` and a Linux `.AppImage` + `.deb`.

## Signing (owner steps)

Builds are unsigned today.

- **macOS:** unsigned apps open with right-click → Open the first time. Signing + notarising needs an Apple Developer account (same one as iOS, US$99/yr) and these GitHub secrets: `APPLE_CERTIFICATE` (base64 .p12 "Developer ID Application"), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`. Tauri's build reads them from the environment.
- **Linux:** AppImage and .deb need no signing to install. Optional: a GPG key to sign the release files (`LINUX_GPG_KEY` secret).

Never commit certificates or passwords; they go in GitHub secrets only.
