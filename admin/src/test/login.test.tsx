import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { ToastProvider } from '../hooks/useToast';
import { AuthProvider } from '../hooks/useAuth';
import { LoginPage } from '../pages/LoginPage';

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
const login = vi.mocked(authApi.login);

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Admin home</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.mockRejectedValue(new Error('401'));
});

describe('login page', () => {
  it('validates the fields before calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Admin sign in' });

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Username or email is required.');
    expect(login).not.toHaveBeenCalled();
  });

  it('shows and hides the password', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Admin sign in' });
    const password = screen.getByLabelText('Password');

    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('signs in and redirects to the dashboard', async () => {
    login.mockResolvedValue({ admin: ADMIN });
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Admin sign in' });

    await user.type(screen.getByLabelText('Username or email'), 'dheera');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Admin home')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith('dheera', 'secret-password');
  });

  it('shows the API error without revealing internals', async () => {
    login.mockRejectedValue(new ApiError('Invalid credentials', 401));
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Admin sign in' });

    await user.type(screen.getByLabelText('Username or email'), 'dheera');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('explains an expired session', async () => {
    renderLogin('/login?expired=1');
    await screen.findByRole('heading', { name: 'Admin sign in' });

    expect(screen.getByText('Your session expired. Please sign in again.')).toBeInTheDocument();
  });
});
