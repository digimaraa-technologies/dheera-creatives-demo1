import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

type FieldName = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldErrors = Partial<Record<FieldName, string>>;

const EMPTY_VALUES: Record<FieldName, string> = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

interface PasswordFieldProps {
  id: FieldName;
  label: string;
  autoComplete: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange(value: string): void;
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  error,
  disabled,
  onChange,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="icon-btn password-toggle"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function SecurityPage() {
  const { changePassword } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setValue(field: FieldName, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const { currentPassword, newPassword, confirmPassword } = values;

    if (!currentPassword) errors.currentPassword = 'Current password is required.';
    if (!newPassword) {
      errors.newPassword = 'New password is required.';
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      errors.newPassword = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (byteLength(newPassword) > MAX_PASSWORD_BYTES) {
      errors.newPassword = `New password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm the new password.';
    } else if (confirmPassword !== newPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    return errors;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      await changePassword(
        values.currentPassword,
        values.newPassword,
        values.confirmPassword,
      );
      notify('Password changed successfully. Please sign in again.', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const lockoutMessage =
          'Too many incorrect password attempts. Please try again after the temporary security lockout.';
        setError(
          err.message === lockoutMessage
            ? lockoutMessage
            : 'Too many password change requests. Please try again shortly.',
        );
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not change the password.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h2>Security</h2>
          <p>
            Change the password for your admin account. You will be signed out of
            every device after the change.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <form className="card form-card" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <PasswordField
            id="currentPassword"
            label="Current password"
            autoComplete="current-password"
            value={values.currentPassword}
            error={fieldErrors.currentPassword}
            disabled={saving}
            onChange={(value) => setValue('currentPassword', value)}
          />

          <PasswordField
            id="newPassword"
            label="New password"
            autoComplete="new-password"
            value={values.newPassword}
            error={fieldErrors.newPassword}
            disabled={saving}
            onChange={(value) => setValue('newPassword', value)}
          />

          <PasswordField
            id="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            value={values.confirmPassword}
            error={fieldErrors.confirmPassword}
            disabled={saving}
            onChange={(value) => setValue('confirmPassword', value)}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
