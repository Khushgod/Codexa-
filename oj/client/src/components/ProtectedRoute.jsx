import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export function ProtectedRoute() {
  const { user, isLoading, startupError } = useAuth();
  const location = useLocation();

  if (isLoading) return <p className="route-status">Restoring your session…</p>;
  if (startupError) return <p className="route-error">{startupError}</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function AdminRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <p className="route-status">Restoring your session…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
