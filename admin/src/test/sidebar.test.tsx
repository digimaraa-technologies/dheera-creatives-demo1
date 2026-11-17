import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { Sidebar } from '../components/Sidebar';
import { ToastProvider } from '../hooks/useToast';
import { AuthProvider } from '../hooks/useAuth';

vi.mock('../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn(), logoutAll: vi.fn() },
}));

const ADMIN = {
  id: 'admin-1',
  username: 'dheera',
  email: 'admin@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const me = vi.mocked(authApi.me);
const logoutAll = vi.mocked(authApi.logoutAll);

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <ToastProvider>
          <Sidebar open onClose={() => undefined} />
          <Routes>
            <Route path="/" element={<div>Admin home</div>} />
            <Route path="/login" element={<div>Login screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.mockResolvedValue({ admin: ADMIN });
});

describe('sign out everywhere', () => {
  it('confirms, revokes every session and returns to login', async () => {
    logoutAll.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderSidebar();
    await screen.findByText('dheera');

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('every active session');
    expect(logoutAll).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(await screen.findByText('Signed out of all sessions.')).toBeInTheDocument();
    expect(logoutAll).toHaveBeenCalledTimes(1);
  });

  it('reports a failure without leaking details and stays usable', async () => {
    logoutAll.mockRejectedValue(new ApiError('Internal server error', 500));
    const user = userEvent.setup();
    renderSidebar();
    await screen.findByText('dheera');

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out everywhere' }),
    );

    expect(
      await screen.findByText('Could not sign out of all sessions. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Admin home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled();
  });
});
