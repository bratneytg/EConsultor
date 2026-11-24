import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { useAuth } from './lib/auth';
import { lazy, Suspense } from 'react';
import { Auth } from './pages/Auth';
import { Home } from './pages/Home';
import { Transactions } from './pages/Transactions';

const Advice = lazy(() => import('./pages/Advice').then((m) => ({ default: m.Advice })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const fallback = <div className="loading-screen" style={{ minHeight: 240 }}><div className="pulse-dot" /></div>;

export function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="loading-screen" aria-busy="true"><div className="pulse-dot" /></div>;
  if (!user) return <Auth />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="movimientos" element={<Transactions />} />
        <Route path="consejos" element={<Suspense fallback={fallback}><Advice /></Suspense>} />
        <Route path="ajustes" element={<Suspense fallback={fallback}><Settings /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
