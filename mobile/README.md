# Parishkar app (iOS + Android)

Expo (SDK 57) + React Native + TypeScript. Opens straight to the camera; files reports into the same live Supabase project as `kasa.html`, through the same RPCs and the same server rules. Not published to the website (excluded in `github-pages.yml` and `.assetsignore`).

## What it does

- **Camera first.** Cold launch → terms (first run only) → camera/location permission → full-screen viewfinder. GPS (`watchPositionAsync`, best accuracy) and a one-time camera token (`kasa_issue_capture_token`) warm up with the viewfinder, so the shutter waits on neither. Shutter fires a heavy haptic immediately, then the photo is resized to 1600 px JPEG.
- **Real GPS only.** A fix must be ≤ 60 m, under 30 s old and not mocked (`LocationObject.mocked`, Android). Otherwise the slider stays locked and the screen says why. No gallery, no map pin.
- **Submit = website flow.** Upload to `kasa-photos/reports/<random>.jpg` → `kasa_photo_meta` (spends the camera token → `capture: live`) → `kasa-photo-check` (background) → `kasa_create_report` → `kasa-notify` when approved. Anonymous Supabase sign-in, so every per-account and per-network cap applies unchanged.
- **Slide to send** (gesture-handler + Reanimated, detent haptic halfway, success haptic at the end). Screen readers get an "activate" action instead.
- **Result card** from server data only: moderation status, duplicate/recurrence, and ward/local body/block from `kasa_public_reports` once approved. Works/contractor/warranty: "No work on record" until a moderator-confirmed works table exists; nothing is ever made up.
- **Offline "snap & hold".** Network failure → photo copied to app documents, draft in SQLite (`queue.db`). Sent on network return (`expo-network` listener), on app start, and by `expo-background-task` (OS-scheduled, ≥ 15 min). `client_id` makes resends idempotent. A server refusal (old photo, outside area, rate limit…) is shown once and dropped; it is never retried.
- **User content controls** (App Store 1.2 / Play UGC policy): "Recent reports" list with **Report** (`kasa_flag_report`, same reasons as the site) and **Hide** (this phone). First-run terms state the content rules and link `terms.html`.
- **Report sheet** (tap any recent report, or "Open the report" after filing): photos, cleanup progress, "I saw it too", rating, official replies, filed-officially numbers, works warranty, timeline, share. Claim / confirm / dispute opens a live camera that checks you are within the site's radius with a good fix (`kasa_claim_cleanup`, `kasa_vote_claim`).
- **At this spot** (More menu): adopt a spot, dog feeding spot, snake sighting (shows rescuers in range with call/WhatsApp), snake rescuer sign-up, puja pandal, public works board. Same fields and RPCs as the kasa.html forms; each needs a good, real GPS fix, and the snake and board photos come from the live camera.
- **What exactly** (`ISSUE_GROUPS` sub-types, sent as `p_waste_type`) and up to two more live photos per report.
- **Look:** CRED's NeoPOP design language (near-black, sharp corners, 3 px 45° raised edges, caps labels). Tokens in `src/components/theme.ts`, our own components in `src/components/Pop.tsx` (no NeoPOP code copied; its palette values are credited).
- **EN / বাংলা / हिन्दी.** Device language by default, switch on the camera screen. Category, flag and server-error wording copied from `kasa-i18n.js`.

## Run it

```bash
cd mobile
npm ci
npx expo run:android      # or run:ios on a Mac with Xcode; needs a real phone for camera/GPS
npm run typecheck
```

Expo Go does not ship every module used here; use a development build (`eas build --profile development`) or `expo run:*`.

## Download builds

`.github/workflows/mobile-build.yml` builds on every change to `mobile/` (and on demand from the Actions tab). On `main` it publishes a GitHub Release `app-build-<n>` with:

- `parishkar.apk`: installable Android build (release, signed with the generated debug key). Open it on the phone and allow installs from that source. Play Store builds still go through EAS (below).
- `parishkar-unsigned.ipa`: iOS build without signing. iPhones refuse unsigned apps, so it installs only after re-signing with an Apple ID (sideloading tools) or through EAS with a developer account.

## Publish (owner steps; can't be done from CI)

1. Accounts: [Apple Developer Program](https://developer.apple.com/programs/) (US$99/yr) and [Google Play Console](https://play.google.com/console/signup) (US$25 once). Google needs identity verification; new personal accounts must run a closed test with ≥ 12 testers for 14 days before production.
2. `npm i -g eas-cli && eas login` (free [expo.dev](https://expo.dev) account), then in `mobile/`: `eas init` (writes the project id into `app.json`).
3. Test builds: `eas build -p android --profile preview` (installable .apk) and `eas build -p ios --profile preview` (needs the Apple account; EAS creates certificates).
4. Store builds: `eas build -p all --profile production`, then `eas submit -p ios` / `eas submit -p android`.
5. Store listings need: privacy policy URL (`privacy.html`), support URL/email, screenshots, content rating questionnaire, Data safety (Play) / App Privacy (Apple): photos + precise location collected, linked to an anonymous id, not used for tracking. Apple review notes: explain anonymous sign-in, the live-photo + GPS rule, and where Report/Hide are.
6. Replace the template icons in `assets/` with Parishkar art before submitting.

## Device identity (proposal, not built)

The pasted blueprint signs reports with a Keychain/Keystore keypair instead of logging in. A self-made key proves nothing on its own (a script can make a million), so it must not replace or loosen anonymous auth, the per-account and per-network caps, capture tokens or photo checks. Server-verified design:

1. App asks the platform for an attestation: **App Attest** (iOS, `DCAppAttestService`) or **Play Integrity** (Android), bound to a server nonce.
2. New edge function `kasa-attest` verifies it with Apple/Google, then stores `(user_id, key_id, verdict, first_seen)` in `kasa_private.device_attestations`.
3. `kasa_create_report` reads that row only to *add* trust (e.g. skip the review queue for live photos from a genuine, unmodified app), never to lift a limit. No attestation = today's behaviour.
4. The same check is where a server-side mock-location verdict belongs (Play Integrity device verdict). Today the app refuses mocked fixes itself and sends `mock_location` in photo metadata, which the server does not read yet.

Needs: Apple Team ID + App Attest entitlement, a Google Cloud project linked in Play Console, and a migration.

## Follow-ups

- Ward, block and GP outlines on the native map (district + seat outlines and report dots are in).
- Push alerts for watched reports.
