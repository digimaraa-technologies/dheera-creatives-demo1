import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner } from './LoadingSpinner';

export function ProtectedRoute() {
  const { status, sessionExpired } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingSpinner fullPage />;
  if (status === 'anonymous') {
    return (
      <Navigate
        to={sessionExpired ? '/login?expired=1' : '/login'}
        replace
        state={{ from: location }}
      />
    );
  }
  return <Outlet />;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingSpinner fullPage />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}
