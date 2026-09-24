# Safari Compatibility Issues Found & Fixed

## Issues to Monitor

### 1. ✅ Geolocation Timeout
**Status:** FIXED
- Increased timeout to 45s for Safari (was 20s)
- Safari permission prompt can take 15-30s

### 2. ✅ Promise.all() Parallel Requests
**Status:** CONFIRMED WORKING
- Using `Promise.all([getCaptureToken(), uploadPhoto()])` 
- Safari supports this since iOS 9+, Mac OS X 10.11+
- Should work fine

### 3. ⚠️ IndexedDB (Offline Queue)
**Status:** Check if works
- Used for storing pending reports
- Safari supports IndexedDB but has size limits (~50MB)
- Check Console for quota warnings

### 4. ⚠️ File API & Blob
**Status:** Check if works
- Photo capture uses Blob API
- createImageBitmap() for resizing
- Should work in modern Safari

### 5. ⚠️ localStorage Isolation
**Status:** Check if working
- Each domain gets separate localStorage
- GitHub Pages isolation shouldn't be an issue
- Check if settings persist after refresh

### 6. ✅ CSS Grid/Flexbox
**Status:** CONFIRMED - all modern
- Grid/Flexbox fully supported in modern Safari
- No vendor prefixes needed

### 7. ⚠️ ServiceWorker (if used)
**Status:** Check implementation
- Look for SW usage for offline handling
- Safari limitations: works but has quirks

## What to Check on Real Mac Safari

1. **Open kasa.html in Safari**
2. **Open DevTools (Cmd+Option+I)**
3. **Check Console for errors** - any red warnings?
4. **Check Network tab**
   - Do token + upload requests start together?
   - Any CORS errors?
   - Any 403/401 errors?

5. **Test offline behavior**
   - Disconnect network
   - Try to submit (should save locally)
   - Reconnect network
   - Check if it auto-uploads

6. **Check localStorage**
   - DevTools → Storage → Local Storage
   - Should see domain entry
   - Any entries there? (should be empty after submit)

7. **Take actual photo**
   - Use camera permission
   - See if it handles camera gracefully
   - Check if photo appears in preview

## Safari Version to Test
- Minimum: Safari 14+ (macOS 11+)
- Recommended: Safari 17+ (macOS 13+)

Check Safari version: Safari menu → About Safari

## If You Find Issues

1. **Screenshot the error** from Console tab
2. **Note the network request** that failed (Network tab)
3. **Check browser version**
4. **Describe exact steps to reproduce**

Example report:
```
Issue: Upload fails with CORS error
Safari: 17.6 (macOS 14.6)
Steps:
1. Click Report Now
2. Take photo
3. Get GPS
4. Click Submit
Error: "No 'Access-Control-Allow-Origin' header"
```
