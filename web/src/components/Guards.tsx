import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import type { UserRole } from '@/lib/types';
import { homeFor } from '@/lib/utils';
import { Spinner } from './ui';

export function RequireAuth({ roles }: { roles?: UserRole[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Restoring session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.must_change_password && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!user.must_change_password && location.pathname === '/change-password') return <Navigate to={homeFor(user.role)} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  if (
    ['staff', 'admin'].includes(user.role)
    && user.mfa?.required
    && (!user.mfa.enrolled || user.mfa.assuranceLevel !== 'aal2')
    && location.pathname !== '/staff/mfa'
  ) return <Navigate to="/staff/mfa" replace />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? (
    <Navigate
      to={user.must_change_password ? '/change-password' : user.mfa?.required && (!user.mfa.enrolled || user.mfa.assuranceLevel !== 'aal2') ? '/staff/mfa' : homeFor(user.role)}
      replace
    />
  ) : <Outlet />;
}
