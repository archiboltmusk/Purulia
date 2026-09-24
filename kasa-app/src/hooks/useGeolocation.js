import { useState, useCallback, useRef } from 'react';

export function useGeolocation() {
  const [location, setLocation] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const watchIdRef = useRef(null);

  const getLocation = useCallback(() => {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      setLoading(false);
      return;
    }

    let gotFirstLocation = false;
    const maxWaitTime = 5000; // 5 second max wait
    const timeoutId = setTimeout(() => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (gotFirstLocation) {
        setLoading(false);
      } else {
        setError('Location timeout - try "Skip Location"');
        setLoading(false);
      }
    }, maxWaitTime);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        // Accept first location immediately
        if (!gotFirstLocation) {
          gotFirstLocation = true;
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
          setAccuracy(pos.coords.accuracy);
          setLoading(false);
          setError(null);

          // Stop watching after getting good accuracy or 5 seconds
          if (pos.coords.accuracy <= 100) {
            clearTimeout(timeoutId);
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
        } else {
          // Update with better accuracy if available
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
          setAccuracy(pos.coords.accuracy);

          // Stop if accuracy is good
          if (pos.coords.accuracy <= 100) {
            clearTimeout(timeoutId);
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
        }
      },
      (err) => {
        clearTimeout(timeoutId);
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        setLoading(false);
        if (err.code === 1) {
          setError('Location permission denied');
        } else if (err.code === 3) {
          setError('Location timeout - try "Skip Location"');
        } else {
          setError('Failed to get location');
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60000 // Use cached location up to 1 minute old
      }
    );
  }, []);

  return { location, accuracy, loading, error, getLocation };
}
