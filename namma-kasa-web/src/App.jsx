import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import { supabase } from './config/supabase'
import Map from './pages/Map'
import ReportSubmit from './pages/ReportSubmit'
import Dashboard from './pages/Dashboard'
import ModerationQueue from './pages/ModerationQueue'
import './index.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkUser()
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null)
    })
    return () => authListener?.unsubscribe()
  }, [])

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
    setLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>

  return (
    <Router>
      <div className="flex flex-col h-screen">
        <header className="bg-blue-600 text-white p-4 shadow-lg">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold">NammaKasa</h1>
            <nav className="flex gap-4 items-center">
              <Link to="/" className="hover:bg-blue-700 px-3 py-2 rounded">Map</Link>
              <Link to="/submit" className="hover:bg-blue-700 px-3 py-2 rounded">Report Issue</Link>
              <Link to="/dashboard" className="hover:bg-blue-700 px-3 py-2 rounded">Analytics</Link>
              {user && <Link to="/moderation" className="hover:bg-blue-700 px-3 py-2 rounded">Moderation</Link>}
              <div className="text-sm">
                {user ? (
                  <button onClick={() => supabase.auth.signOut()} className="hover:bg-blue-700 px-3 py-2 rounded">
                    Sign Out
                  </button>
                ) : (
                  <span>Sign in to moderate</span>
                )}
              </div>
            </nav>
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Map />} />
            <Route path="/submit" element={<ReportSubmit />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/moderation" element={user ? <ModerationQueue /> : <div>Login required</div>} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
