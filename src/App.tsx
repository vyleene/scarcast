import { lazy, Suspense } from 'react'
import LandingPage from './pages/LandingPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '')
  return path === '/dashboard' || path === '/app'
    ? <Suspense fallback={<div style={{ minHeight: '100svh', background: '#141719', display: 'grid', placeItems: 'center', color: '#F65927' }}>Opening the field atlas…</div>}><DashboardPage /></Suspense>
    : <LandingPage />
}
