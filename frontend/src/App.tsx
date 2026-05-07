import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import ScanPage from './pages/ScanPage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/scan" replace />} />
    </Routes>
  );
}
