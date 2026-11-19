import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { ToastProvider } from '../hooks/useToast';
import { AuthProvider } from '../hooks/useAuth';
import { SecurityPage } from '../pages/SecurityPage';

vi.mock('../api/auth', () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    changePassword: vi.fn(),
  },
}));

const ADMIN = {
  id: 'admin-1',
  username: 'dheera',
  email: 'admin@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NEW_PASSWORD = 'a-brand-new-passphrase';

const me = vi.mocked(authApi.me);
const changePassword = vi.mocked(authApi.changePassword);

function renderSecurity() {
  return render(
    <MemoryRouter initialEntries={['/security']}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/login" element={<div>Login screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillForm(values: {
  current?: string;
  next?: string;
  confirm?: string;
} = {}): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText('Current password'),
    values.current ?? 'current-password',
  );
  await user.type(screen.getByLabelText('New password'), values.next ?? NEW_PASSWORD);
  await user.type(
    screen.getByLabelText('Confirm new password'),
    values.confirm ?? values.next ?? NEW_PASSWORD,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.mockResolvedValue({ admin: ADMIN });
});

describe('security page', () => {
  it('validates that all password fields are filled', async () => {
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(screen.getByText('Current password is required.')).toBeInTheDocument();
    expect(screen.getByText('New password is required.')).toBeInTheDocument();
    expect(screen.getByText('Please confirm the new password.')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 12 characters', async () => {
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm({ next: 'short-passw' });
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(
      screen.getByText('New password must be at least 12 characters.'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects a new password longer than 72 UTF-8 bytes', async () => {
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    const tooLong = 'é'.repeat(37);
    await fillForm({ next: tooLong });
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(
      screen.getByText('New password must be at most 72 UTF-8 bytes.'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match', async () => {
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm({ next: NEW_PASSWORD, confirm: 'a-different-passphrase' });
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('shows and hides each password', async () => {
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    const current = screen.getByLabelText('Current password');
    expect(current).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show current password' }));
    expect(current).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide current password' }));
    expect(current).toHaveAttribute('type', 'password');
  });

  it('disables the form while the request is pending', async () => {
    let resolveChange: (value: { success: true; redirectTo: string }) => void = () =>
      undefined;
    changePassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChange = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm();
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    const saving = screen.getByRole('button', { name: 'Updating…' });
    expect(saving).toBeDisabled();
    expect(screen.getByLabelText('Current password')).toBeDisabled();

    await act(async () => {
      resolveChange({ success: true, redirectTo: '/login' });
    });
  });

  it('changes the password, shows a toast and redirects to login', async () => {
    changePassword.mockResolvedValue({ success: true, redirectTo: '/login' });
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm();
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(
      screen.getByText('Password changed successfully. Please sign in again.'),
    ).toBeInTheDocument();
    expect(changePassword).toHaveBeenCalledWith(
      'current-password',
      NEW_PASSWORD,
      NEW_PASSWORD,
    );
  });

  it('shows the API error and keeps the form usable', async () => {
    changePassword.mockRejectedValue(
      new ApiError('Current password is incorrect', 400),
    );
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm();
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Current password is incorrect',
    );
    expect(screen.getByRole('button', { name: 'Update Password' })).toBeEnabled();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
  });

  it('shows a clear lockout message on HTTP 429 without sensitive details', async () => {
    changePassword.mockRejectedValue(
      new ApiError(
        'Too many incorrect password attempts. Please try again after the temporary security lockout.',
        429,
        { message: 'Too many incorrect password attempts. Please try again after the temporary security lockout.' },
      ),
    );
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm();
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many incorrect password attempts. Please try again after the temporary security lockout.',
    );
    expect(alert).not.toHaveTextContent('token');
    expect(alert).not.toHaveTextContent('hash');
    expect(alert).not.toHaveTextContent('passwordHash');
    expect(alert).not.toHaveTextContent('cookie');
    expect(alert).not.toHaveTextContent('secret');
    expect(screen.getByRole('button', { name: 'Update Password' })).toBeEnabled();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
  });

  it('keeps submit disabled during a pending 429 response and recovers', async () => {
    let rejectChange: (reason?: unknown) => void = () => undefined;
    changePassword.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectChange = reject;
        }),
    );
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm();
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(screen.getByLabelText('Current password')).toBeDisabled();

    await act(async () => {
      rejectChange(
        new ApiError(
          'Too many incorrect password attempts. Please try again after the temporary security lockout.',
          429,
        ),
      );
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many incorrect password attempts. Please try again after the temporary security lockout.',
    );
    expect(screen.getByRole('button', { name: 'Update Password' })).toBeEnabled();
    expect(screen.getByLabelText('Current password')).toBeEnabled();
  });

  it('shows a generic retry message for queue-saturation 429 responses', async () => {
    changePassword.mockRejectedValue(
      new ApiError('Too many password change requests. Please try again shortly.', 429),
    );
    const user = userEvent.setup();
    renderSecurity();
    await screen.findByRole('heading', { name: 'Security' });

    await fillForm();
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many password change requests. Please try again shortly.',
    );
    expect(screen.getByRole('button', { name: 'Update Password' })).toBeEnabled();
  });
});
