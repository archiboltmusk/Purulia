import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { supabase } from '../config/supabase'

export default function ReportSubmit() {
  const { register, handleSubmit, watch } = useForm()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [gps, setGps] = useState(null)
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState(null)
  const description = watch('description')

  useEffect(() => {
    if (!cameraActive) return

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      })
      .catch(err => alert('Camera permission denied: ' + err.message))

    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop())
      }
    }
  }, [cameraActive])

  async function getGPS() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        reject
      )
    })
  }

  async function getCaptureToken() {
    const { data, error } = await supabase.functions.invoke('kasa-photo-token')
    if (error) {
      alert('Failed to get capture token: ' + error.message)
      return null
    }
    return data.token
  }

  async function capturePhoto() {
    try {
      // Get token first
      const t = await getCaptureToken()
      if (!t) return
      setToken(t)

      // Get GPS
      const coords = await getGPS()
      setGps(coords)

      // Capture photo
      const context = canvasRef.current.getContext('2d')
      context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height)
      const photoData = canvasRef.current.toDataURL('image/jpeg')
      setPhoto(photoData)
      setCameraActive(false)
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  async function onSubmit(data) {
    if (!photo || !gps || !token) {
      alert('Missing photo, GPS, or token')
      return
    }

    setLoading(true)
    try {
      // Convert photo to blob
      const blob = await fetch(photo).then(r => r.blob())
      const filename = `reports/${Math.random().toString(36).slice(2, 18)}.jpg`

      // Upload photo
      const { error: uploadErr } = await supabase.storage
        .from('kasa-photos')
        .upload(filename, blob)

      if (uploadErr) throw uploadErr

      // Submit report with token and GPS
      const { error: checkErr } = await supabase.functions.invoke('kasa-photo-check', {
        body: {
          path: filename,
          token,
          lat: gps.lat,
          lng: gps.lng,
        }
      })

      if (checkErr) throw checkErr

      // Create report record
      const { data: { user } } = await supabase.auth.getUser()
      const { error: dbErr } = await supabase
        .from('kasa_reports')
        .insert({
          photo_path: filename,
          description: data.description,
          ward: data.ward || 'Unknown',
          latitude: gps.lat,
          longitude: gps.lng,
          user_id: user?.id,
          status: 'pending_review'
        })

      if (dbErr) throw dbErr

      alert('Report submitted successfully!')
      setPhoto(null)
      setGps(null)
      setToken(null)
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-3xl font-bold mb-6">Report an Issue</h2>

      {!cameraActive && !photo && (
        <button
          onClick={() => setCameraActive(true)}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 mb-4"
        >
          📷 Open Camera
        </button>
      )}

      {cameraActive && (
        <div className="mb-4">
          <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg mb-2" />
          <canvas ref={canvasRef} style={{ display: 'none' }} width="1280" height="720" />
          <div className="flex gap-2">
            <button
              onClick={capturePhoto}
              className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700"
            >
              ✓ Capture
            </button>
            <button
              onClick={() => setCameraActive(false)}
              className="flex-1 bg-gray-600 text-white py-2 rounded-lg hover:bg-gray-700"
            >
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {photo && (
        <div className="mb-4">
          <img src={photo} alt="Captured" className="w-full rounded-lg mb-2" />
          <p className="text-sm text-gray-600">
            📍 {gps?.lat.toFixed(4)}, {gps?.lng.toFixed(4)}
          </p>
          <button
            onClick={() => { setPhoto(null); setCameraActive(true) }}
            className="text-blue-600 hover:underline text-sm"
          >
            Retake
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block font-semibold mb-2">Ward</label>
          <input
            {...register('ward')}
            type="text"
            placeholder="Enter ward name or number"
            className="w-full border rounded-lg p-2"
          />
        </div>

        <div>
          <label className="block font-semibold mb-2">Description</label>
          <textarea
            {...register('description')}
            placeholder="Describe the issue (potholes, garbage, water logging, etc.)"
            rows="4"
            className="w-full border rounded-lg p-2"
          />
          <p className="text-xs text-gray-500 mt-1">{description?.length || 0} characters</p>
        </div>

        <button
          type="submit"
          disabled={!photo || loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Submit Report'}
        </button>
      </form>
    </div>
  )
}
