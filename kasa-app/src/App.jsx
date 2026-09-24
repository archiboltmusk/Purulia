import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { initSupabase } from './api/supabase';
import ReportForm from './components/ReportForm';
import ModerationDashboard from './components/ModerationDashboard';
import './kasa.css';

function App() {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const script = document.createElement('script');
        script.src = './config.js';
        script.onload = () => {
          if (window.KASA_CONFIG) {
            initSupabase();
            setConfigLoaded(true);
          } else {
            setError('Failed to load configuration: KASA_CONFIG not found');
          }
        };
        script.onerror = () => {
          setError('Failed to load config.js');
        };
        document.head.appendChild(script);
      } catch (err) {
        setError('Failed to load configuration: ' + err.message);
      }
    };

    loadConfig();
  }, []);

  if (error) {
    return <div style={{ color: 'var(--red)', padding: '2rem' }}>{error}</div>;
  }

  if (!configLoaded) {
    return <div style={{ padding: '2rem' }}>Loading configuration...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/moderation" element={<ModerationDashboard />} />
        <Route path="/" element={<ReportForm />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
