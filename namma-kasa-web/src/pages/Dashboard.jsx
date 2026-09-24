import { useEffect, useState } from 'react'
import { supabase } from '../config/supabase'

export default function Dashboard() {
  const [stats, setStats] = useState({
    total_reports: 0,
    resolved_reports: 0,
    pending_reports: 0,
    top_wards: [],
    cleanup_streak: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      // Total and resolved counts
      const { data: approved } = await supabase
        .from('kasa_reports')
        .select('*', { count: 'exact' })
        .eq('status', 'approved')

      const { data: resolved } = await supabase
        .from('kasa_reports')
        .select('*', { count: 'exact' })
        .eq('status', 'resolved')

      const { data: pending } = await supabase
        .from('kasa_reports')
        .select('*', { count: 'exact' })
        .eq('status', 'pending_review')

      // Top wards
      const { data: wardCounts } = await supabase
        .from('kasa_reports')
        .select('ward')
        .eq('status', 'approved')

      const wardMap = {}
      wardCounts?.forEach(r => {
        wardMap[r.ward] = (wardMap[r.ward] || 0) + 1
      })

      const topWards = Object.entries(wardMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))

      setStats({
        total_reports: approved?.length || 0,
        resolved_reports: resolved?.length || 0,
        pending_reports: pending?.length || 0,
        top_wards: topWards,
        cleanup_streak: 0,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="p-6">Loading...</div>

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h2 className="text-3xl font-bold">Analytics Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-blue-100 p-6 rounded-lg">
          <p className="text-gray-600 text-sm">Total Reports</p>
          <p className="text-3xl font-bold text-blue-600">{stats.total_reports}</p>
        </div>
        <div className="bg-green-100 p-6 rounded-lg">
          <p className="text-gray-600 text-sm">Resolved</p>
          <p className="text-3xl font-bold text-green-600">{stats.resolved_reports}</p>
        </div>
        <div className="bg-yellow-100 p-6 rounded-lg">
          <p className="text-gray-600 text-sm">Pending Review</p>
          <p className="text-3xl font-bold text-yellow-600">{stats.pending_reports}</p>
        </div>
        <div className="bg-purple-100 p-6 rounded-lg">
          <p className="text-gray-600 text-sm">Resolution Rate</p>
          <p className="text-3xl font-bold text-purple-600">
            {stats.total_reports > 0 ? Math.round((stats.resolved_reports / stats.total_reports) * 100) : 0}%
          </p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-2xl font-bold mb-4">Top Wards by Reports</h3>
        <div className="space-y-3">
          {stats.top_wards.map((ward, i) => (
            <div key={i} className="flex justify-between items-center">
              <span className="font-semibold">{ward.name}</span>
              <div className="flex items-center gap-3">
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${(ward.count / stats.top_wards[0].count) * 100}%` }}
                  />
                </div>
                <span className="font-bold">{ward.count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
