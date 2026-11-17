import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '../api/auth';
import { ApiError, UNAUTHORIZED_EVENT } from '../api/client';
import type { Admin } from '../types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  admin: Admin | null;
  status: Status;
  sessionExpired: boolean;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);

  // The session lives in an HttpOnly cookie; ask the API who we are on load.
  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then(({ admin: current }) => {
        if (!active) return;
        setAdmin(current);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!active) return;
        setAdmin(null);
        setStatus('anonymous');
      });
    return () => {
      active = false;
    };
  }, []);

  // Any guarded API call that returns 401 means the session is gone.
  useEffect(() => {
    const onUnauthorized = () => {
      setAdmin(null);
      setStatus('anonymous');
      setSessionExpired(true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const { admin: current } = await authApi.login(identifier, password);
    setAdmin(current);
    setStatus('authenticated');
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The session may already be gone; clear local state either way.
    } finally {
      setAdmin(null);
      setStatus('anonymous');
      setSessionExpired(false);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } catch (error) {
      // A 401 means the session is already gone; anything else is a real failure.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    setAdmin(null);
    setStatus('anonymous');
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({ admin, status, sessionExpired, login, logout, logoutAll }),
    [admin, status, sessionExpired, login, logout, logoutAll],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
