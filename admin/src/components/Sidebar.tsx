import { LayoutDashboard, LogOut, Package, Scissors, ShieldCheck, ShieldOff, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ConfirmDialog } from './ConfirmDialog';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/products', label: 'Products', icon: Package, end: false },
  { to: '/services', label: 'Services', icon: Scissors, end: false },
  { to: '/security', label: 'Security', icon: ShieldCheck, end: false },
];

interface SidebarProps {
  open: boolean;
  onClose(): void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { admin, logout, logoutAll } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  async function onLogoutAll(): Promise<void> {
    setRevokingAll(true);
    try {
      await logoutAll();
      notify('Signed out of all sessions.', 'success');
      navigate('/login', { replace: true });
    } catch {
      notify('Could not sign out of all sessions. Please try again.', 'error');
    } finally {
      setRevokingAll(false);
      setConfirmingAll(false);
    }
  }

  return (
    <>
      <div
        className={open ? 'sidebar-overlay open' : 'sidebar-overlay'}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <div>
            <strong>Dheera Creatives</strong>
            <span>Admin studio</span>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-close"
            aria-label="Close menu"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Admin sections">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              onClick={onClose}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">
              {admin?.username.slice(0, 1).toUpperCase() ?? '?'}
            </span>
            <div>
              <strong>{admin?.username ?? 'Admin'}</strong>
              <span>{admin?.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="nav-link"
            onClick={() => setConfirmingAll(true)}
          >
            <ShieldOff size={18} aria-hidden="true" />
            Sign out everywhere
          </button>
          <button type="button" className="nav-link logout" onClick={() => void logout()}>
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      {confirmingAll && (
        <ConfirmDialog
          title="Sign out everywhere?"
          message="This revokes every active session for this admin account, including this browser. Every device will need to sign in again."
          confirmLabel="Sign out everywhere"
          busyLabel="Signing out…"
          busy={revokingAll}
          onConfirm={() => void onLogoutAll()}
          onCancel={() => setConfirmingAll(false)}
        />
      )}
    </>
  );
}
