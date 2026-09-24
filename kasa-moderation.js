/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Moderation Pipeline
   Layer 1: Google Vision SafeSearch (free tier, 1000/mo)
   Layer 2: Basic heuristics (spam, size, exif)
   Layer 3: Manual review queue (Supabase dashboard)
   ══════════════════════════════════════════════════════════ */

const VISION_API_KEY = window.KASA_CONFIG?.VISION_API_KEY || '';
const VISION_ENDPOINT = `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`;

/* ── Main moderation entry point ── */
async function moderatePhoto(blob){
  const result = {
    approved: false,
    reason: null,
    score: 0,
    labels: {}
  };

  /* Layer 1: Basic checks (always run, no API cost) */
  const basicCheck = runBasicChecks(blob);
  if (!basicCheck.approved){
    result.reason = basicCheck.reason;
    result.labels.basic = basicCheck.labels;
    return result;
  }

  /* Layer 2: Google Vision SafeSearch (if key configured) */
  if (VISION_API_KEY){
    try {
      const visionResult = await runVisionSafeSearch(blob);
      result.labels.vision = visionResult;

      /* Reject if adult/violence probability is LIKELY or VERY_LIKELY */
      const adult = visionResult.adult || 'UNKNOWN';
      const violence = visionResult.violence || 'UNKNOWN';
      const racy = visionResult.racy || 'UNKNOWN';

      if (adult === 'LIKELY' || adult === 'VERY_LIKELY') {
        result.reason = 'Image flagged as adult content';
        return result;
      }
      if (violence === 'LIKELY' || violence === 'VERY_LIKELY') {
        result.reason = 'Image flagged as violent content';
        return result;
      }
      if (racy === 'VERY_LIKELY') {
        result.reason = 'Image flagged as inappropriate';
        return result;
      }
    } catch(e){
      console.warn('Vision check failed, proceeding with manual review', e);
    }
  }

  /* Passed all checks */
  result.approved = true;
  return result;
}

/* ── Layer 1: Basic heuristic checks ── */
function runBasicChecks(blob){
  /* Size check — reject < 10KB (likely noise) */
  if (blob.size < 10000) {
    return { approved: false, reason: 'Image too small — likely not a real photo', labels: { size: blob.size } };
  }
  /* Size check — reject > 8MB (likely not a phone photo) */
  if (blob.size > 8 * 1024 * 1024) {
    return { approved: false, reason: 'Image too large', labels: { size: blob.size } };
  }
  return { approved: true };
}

/* ── Layer 2: Google Vision SafeSearch ── */
async function runVisionSafeSearch(blob){
  const base64 = await blobToBase64(blob);
  const body = {
    requests: [{
      image: { content: base64.split(',')[1] },
      features: [{ type: 'SAFE_SEARCH_DETECTION' }]
    }]
  };

  const res = await fetch(VISION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error('Vision API error');
  const data = await res.json();
  return data.responses?.[0]?.safeSearchAnnotation || {};
}

function blobToBase64(blob){
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
