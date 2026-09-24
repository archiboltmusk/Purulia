import React, { useState, useRef } from 'react';
import { useGeolocation } from '../hooks/useGeolocation';
import { createReport } from '../api/supabase';
import './ReportForm.css';

export default function ReportForm() {
  const { location, accuracy, loading, error, getLocation } = useGeolocation();
  const [photo, setPhoto] = useState(null);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('minor');
  const [description, setDescription] = useState('');
  const [ward, setWard] = useState('');
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [landmark, setLandmark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const cameraRef = useRef(null);

  const minAccuracy = 100;
  const hasGoodGPS = accuracy && accuracy <= minAccuracy;
  const canSubmit = category && photo && hasGoodGPS && ward;

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        canvas.toBlob((blob) => {
          if (!blob) { setSubmitError('Could not read this photo. Try another.'); return; }
          setPhoto({ blob, url: URL.createObjectURL(blob) });
        }, 'image/jpeg', 0.8);
      };
      img.onerror = () => setSubmitError('Could not read this photo. Try another.');
      img.src = URL.createObjectURL(file);
    } catch (err) {
      setSubmitError('Failed to process photo: ' + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const exifMeta = {
        exifLat: null,
        exifLng: null,
        faceCount: 0,
        sha256: '',
        dhash: ''
      };

      await createReport({
        category,
        severity,
        lat: location.lat,
        lng: location.lng,
        accuracy,
        ward: Number(ward),
        description: description || null,
        landmark: landmark || null,
        photoBlob: photo.blob,
        photoMeta: exifMeta,
        clientId
      });

      setSubmitSuccess(true);
      setPhoto(null);
      setCategory('');
      setSeverity('minor');
      setDescription('');
      setWard('');
      setLandmark('');
      setClientId(crypto.randomUUID());

      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err) {
      setSubmitError(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-form">
      <h1 className="report-title">Report a Civic Issue</h1>

      {submitSuccess && (
        <div className="success-message">✓ Report submitted successfully!</div>
      )}

      {submitError && (
        <div className="error-message">{submitError}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-section">
          <label>Category *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            <option value="">Select category</option>
            <option value="garbage">Garbage / Waste</option>
            <option value="drain">Drain</option>
            <option value="road">Road</option>
            <option value="streetlight">Streetlight</option>
            <option value="water">Water</option>
            <option value="missing">Missing infrastructure</option>
            <option value="encroachment">Encroachment</option>
            <option value="illegal_construction">Illegal construction</option>
            <option value="illegal_mining">Illegal mining</option>
            <option value="illegal_other">Other illegal activity</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="form-section">
          <label>Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="minor">Minor</option>
            <option value="severe">Severe</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div className="form-section">
          <label>Ward Number *</label>
          <select
            value={ward}
            onChange={(e) => setWard(e.target.value)}
            required
          >
            <option value="">Select ward</option>
            {Array.from({ length: 23 }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>Ward {n}</option>
            ))}
          </select>
        </div>

        <div className="form-section">
          <label>Photo *</label>
          <div className="photo-upload">
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="camera-btn"
            >
              📷 Take Photo
            </button>
            {photo && (
              <div className="photo-preview">
                <img src={photo.url} alt="Preview" />
              </div>
            )}
          </div>
        </div>

        <div className="form-section">
          <label>Location</label>
          <button
            type="button"
            onClick={getLocation}
            disabled={loading}
            className={`gps-btn ${hasGoodGPS ? 'good' : ''}`}
          >
            {loading ? '⏳ Getting location...' : hasGoodGPS ? '✓ GPS Good' : '📍 Get GPS'}
          </button>
          {location && (
            <div className="gps-info">
              <div>Lat: {location.lat.toFixed(4)}</div>
              <div>Lng: {location.lng.toFixed(4)}</div>
              <div>Accuracy: {Math.round(accuracy)}m {accuracy <= minAccuracy ? '✓' : '⚠'}</div>
              {accuracy > minAccuracy && (
                <div className="accuracy-warning">
                  GPS accuracy is {Math.round(accuracy)}m (need ≤{minAccuracy}m)
                </div>
              )}
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="form-section">
          <label>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue..."
            rows="3"
          />
        </div>

        <div className="form-section">
          <label>Landmark (optional)</label>
          <input
            type="text"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            placeholder="Nearby landmark"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="submit-btn"
          title={!hasGoodGPS ? `GPS accuracy is ${Math.round(accuracy)}m (need ≤${minAccuracy}m)` : ''}
        >
          {submitting ? '⏳ Submitting...' : 'Submit Report'}
        </button>
      </form>
    </div>
  );
}
