# Mac Safari Testing Checklist

## Location/GPS Testing
- [ ] Click "Get GPS" button
  - Verify permission prompt appears
  - Verify accuracy displays in real-time ("Getting location… (245m) •")
  - Verify checkmark (✓) appears when ≤100m achieved
  - Verify "Skip location" button works - clicking skips GPS wait
  - Verify button shows "High accuracy" or "GPS (45m)" after success
  - Test with poor signal area (accuracy >100m) - verify submit button stays disabled

## Photo Capture
- [ ] Take a photo using camera
  - Verify photo appears in preview
  - Verify photo is compressed (check file size in DevTools)
  - Verify compression doesn't make image blurry

## Report Submission
- [ ] With good GPS (≤100m) - submit should work
  - Watch browser Network tab in DevTools
  - Verify requests happen in parallel (token + upload together, not sequential)
  - Verify upload completes
  - Verify "Uploading…" message appears
- [ ] With poor GPS (>100m) - submit button should be disabled
  - Hover over submit button
  - Verify tooltip shows "GPS accuracy is Xm (need ≤100m for accuracy)"
- [ ] Offline while uploading
  - Verify report saves locally
  - Go online and verify it uploads automatically

## Performance
- [ ] DevTools Network tab
  - Check request waterfall
  - Verify parallel requests (should see token + upload starting simultaneously)
  - Measure total upload time (should be <10s for photo)
  - Check for any failed requests (red) in Network tab

## UI/Safari-Specific
- [ ] Viewport fits screen without horizontal scroll
- [ ] All buttons are clickable (not too small for Safari)
- [ ] Modal overlays work
- [ ] Text input fields are usable (not covered by keyboard)
- [ ] Touch scrolling works smoothly
- [ ] No console errors (DevTools → Console)

## Known Safari Quirks to Watch
- ⚠️ Geolocation permission prompt may take 30-45 seconds (we handle this)
- ⚠️ localStorage works but is isolated per domain
- ⚠️ Camera permissions separate from geolocation
- ⚠️ HTTPS required (no HTTP for geolocation/camera)

## Testing Instructions
1. Open Safari on Mac
2. Go to: https://archiboltmusk.github.io/Purulia/kasa.html
3. Open DevTools: Cmd+Option+I
4. Go to Network tab to watch requests
5. Follow checklist above
6. Report any issues with screenshots/video if possible

## Common Issues to Check
- "Getting location..." hangs > 45 seconds?
  → Check browser console for geolocation errors
- Upload fails after photo taken?
  → Check Network tab for 403/400 errors
  → Verify HTTPS connection
- "Waiting to upload" message stuck?
  → Check if offline indicator is showing
  → Try hard refresh (Cmd+Shift+R)
- Submit button won't enable?
  → Verify GPS accuracy is ≤100m
  → Verify all fields filled (category, photo, ward)
