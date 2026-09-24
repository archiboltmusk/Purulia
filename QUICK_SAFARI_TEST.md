# Quick Mac Safari Test (5 minutes)

## URL
https://archiboltmusk.github.io/Purulia/kasa.html

## Test Steps

### 1. Location Testing (1 min)
- [ ] Click "Report Now" button
- [ ] Click "Get GPS" button
- [ ] Watch accuracy count down (should show real-time numbers like "245m", "156m", "42m")
- [ ] When it reaches ≤100m, you should see a ✓ checkmark
- [ ] Button should change to "✓ High accuracy" or "✓ GPS (42m)"
- [ ] Note: On first use, Safari will ask for location permission — click "Allow"

**Expected:** Accuracy improves over 10-30 seconds, button shows progress

### 2. Photo Test (1 min)
- [ ] Click camera icon to take photo
- [ ] Take a selfie or photo of something
- [ ] Verify photo appears in preview
- [ ] Photo should be compressed to <2MB

**Expected:** Photo appears instantly, no lag

### 3. Upload Test (2 min)
- [ ] Select a category from dropdown
- [ ] Enter a description (any text)
- [ ] Verify submit button is now **enabled** (it should be if GPS is good)
- [ ] Open Safari DevTools: Cmd+Option+I
- [ ] Click Network tab
- [ ] Click "Submit Report" button
- [ ] Watch Network tab — you should see multiple requests fire
- [ ] Key metric: **Token + Upload should start at roughly the same time** (parallel, not sequential)
- [ ] Wait for "done" screen

**Expected:** 
- Submit completes in <10-15 seconds
- See "Report submitted" confirmation
- Network tab shows parallel requests

### 4. Check for Errors (1 min)
- [ ] Click Console tab in DevTools
- [ ] Any red errors? (scroll to top)
- [ ] Any yellow warnings? (can usually ignore these)

**Expected:** No red errors, clean console

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| "Getting location..." stuck >45s | Try "skip location" button, or check Settings → Safari → Location Services |
| Photo doesn't appear | Check camera permissions: System Settings → Privacy → Camera |
| Submit button won't enable | Verify GPS accuracy ≤100m (check in coordinates display) |
| Upload fails | Check Network tab for red requests, check console for errors |
| Whole page seems slow | Hard refresh: Cmd+Shift+R |

## Report Results

If everything works:
- ✅ Location works well on Safari
- ✅ Upload is fast (parallel requests)
- ✅ GPS accuracy requirement ensures true data

If issues found:
1. Screenshot the error
2. Note Safari version (Safari → About Safari)
3. Describe exact steps to reproduce
4. Check Network tab for failed requests
