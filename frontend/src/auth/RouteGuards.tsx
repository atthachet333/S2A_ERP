import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
const Loading = () => <div className="loading-screen"><img src="/s2a-logo.png" alt="S2A ERP" /><span>กำลังเตรียมระบบ...</span></div>;
export function ProtectedRoute() {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}
export function PasswordRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
