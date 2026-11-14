import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { AuthProvider, useAuth } from '../hooks/useAuth';

vi.mock('../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));

const ADMIN = {
  id: 'admin-1',
  username: 'dheera',
  email: 'admin@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const me = vi.mocked(authApi.me);
const logout = vi.mocked(authApi.logout);

function LoginProbe() {
  const [params] = useSearchParams();
  return <div>Login screen {params.get('expired') ?? ''}</div>;
}

function Dashboard() {
  const { admin, logout: signOut } = useAuth();
  return (
    <div>
      <span>Dashboard secret {admin?.username}</span>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Dashboard />} />
          </Route>
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('session restoration', () => {
  it('shows a loading state while the session is checked', () => {
    me.mockReturnValue(new Promise(() => undefined));
    renderApp();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('restores an existing session from /api/auth/me', async () => {
    me.mockResolvedValue({ admin: ADMIN });
    renderApp();

    expect(await screen.findByText('Dashboard secret dheera')).toBeInTheDocument();
  });

  it('redirects to the login page when there is no session', async () => {
    me.mockRejectedValue(new Error('401'));
    renderApp();

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('marks the session as expired after a guarded call returns 401', async () => {
    me.mockResolvedValue({ admin: ADMIN });
    renderApp();
    await screen.findByText('Dashboard secret dheera');

    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });

    expect(await screen.findByText('Login screen 1')).toBeInTheDocument();
  });
});

describe('logout', () => {
  it('clears the session and returns to login', async () => {
    me.mockResolvedValue({ admin: ADMIN });
    logout.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Dashboard secret dheera');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('still clears local state when the logout request fails', async () => {
    me.mockResolvedValue({ admin: ADMIN });
    logout.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Dashboard secret dheera');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });
});
