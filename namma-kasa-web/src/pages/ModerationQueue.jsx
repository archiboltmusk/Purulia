import { useEffect, useState } from 'react'
import { supabase } from '../config/supabase'

export default function ModerationQueue() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState(null)

  useEffect(() => {
    loadPendingReports()
  }, [])

  async function loadPendingReports() {
    const { data, error } = await supabase
      .from('kasa_reports')
      .select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })

    if (!error) setReports(data || [])
    setLoading(false)
  }

  async function updateReportStatus(id, status) {
    const { error } = await supabase
      .from('kasa_reports')
      .update({ status, moderated_at: new Date() })
      .eq('id', id)

    if (!error) {
      setReports(reports.filter(r => r.id !== id))
      setSelectedReport(null)
      alert(`Report ${status}`)
    } else {
      alert('Error: ' + error.message)
    }
  }

  if (loading) return <div className="p-6">Loading...</div>

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h2 className="text-3xl font-bold mb-6">Moderation Queue</h2>
      <p className="text-gray-600 mb-4">{reports.length} reports pending review</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-lg shadow max-h-96 overflow-y-auto">
          {reports.map(report => (
            <div
              key={report.id}
              onClick={() => setSelectedReport(report)}
              className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${
                selectedReport?.id === report.id ? 'bg-blue-50' : ''
              }`}
            >
              <p className="font-semibold text-sm">{report.description.substring(0, 50)}...</p>
              <p className="text-xs text-gray-500">{report.ward}</p>
            </div>
          ))}
        </div>

        {selectedReport && (
          <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
            <h3 className="text-2xl font-bold mb-4">{selectedReport.description}</h3>

            {selectedReport.photo_path && (
              <img
                src={supabase.storage.from('kasa-photos').getPublicUrl(selectedReport.photo_path).data.publicUrl}
                alt="Report"
                className="w-full rounded-lg mb-4 max-h-96 object-cover"
              />
            )}

            <div className="space-y-2 mb-6">
              <p><strong>Ward:</strong> {selectedReport.ward}</p>
              <p><strong>Location:</strong> {selectedReport.latitude.toFixed(4)}, {selectedReport.longitude.toFixed(4)}</p>
              <p><strong>Submitted:</strong> {new Date(selectedReport.created_at).toLocaleString()}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => updateReportStatus(selectedReport.id, 'approved')}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg font-semibold hover:bg-green-700"
              >
                ✓ Approve
              </button>
              <button
                onClick={() => updateReportStatus(selectedReport.id, 'rejected')}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700"
              >
                ✕ Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
