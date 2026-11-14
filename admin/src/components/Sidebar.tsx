import { LayoutDashboard, LogOut, Package, Scissors, Sparkles, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/products', label: 'Products', icon: Package, end: false },
  { to: '/services', label: 'Services', icon: Scissors, end: false },
];

interface SidebarProps {
  open: boolean;
  onClose(): void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { admin, logout } = useAuth();

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
          <button type="button" className="nav-link logout" onClick={() => void logout()}>
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
