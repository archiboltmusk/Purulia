import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { supabase } from '../config/supabase'
import L from 'leaflet'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

export default function Map() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadReports()
    const subscription = supabase
      .channel('reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kasa_reports' }, () => loadReports())
      .subscribe()

    return () => subscription.unsubscribe()
  }, [])

  async function loadReports() {
    const { data, error } = await supabase
      .from('kasa_reports')
      .select('*')
      .eq('status', 'approved')
      .limit(500)

    if (!error) setReports(data || [])
    setLoading(false)
  }

  return (
    <div className="w-full h-full">
      {loading && <div className="absolute top-4 left-4 bg-white p-3 rounded shadow-lg z-10">Loading...</div>}

      <MapContainer center={[13.0827, 80.2707]} zoom={11} className="w-full h-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© OpenStreetMap contributors'
        />
        {reports.map(report => (
          <Marker key={report.id} position={[report.latitude, report.longitude]}>
            <Popup>
              <div className="max-w-xs">
                {report.photo_path && (
                  <img src={supabase.storage.from('kasa-photos').getPublicUrl(report.photo_path).data.publicUrl} alt="Report" className="w-full rounded mb-2" />
                )}
                <p className="font-semibold">{report.description}</p>
                <p className="text-sm text-gray-600">Ward: {report.ward}</p>
                <p className="text-sm text-gray-600">Status: {report.status}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
