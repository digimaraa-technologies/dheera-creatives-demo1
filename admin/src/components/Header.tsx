import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, 'Dashboard'],
  [/^\/products\/new$/, 'Add product'],
  [/^\/products\/[^/]+\/edit$/, 'Edit product'],
  [/^\/products/, 'Products'],
  [/^\/services\/new$/, 'Add service'],
  [/^\/services\/[^/]+\/edit$/, 'Edit service'],
  [/^\/services/, 'Services'],
  [/^\/security$/, 'Security'],
];

export function Header({ onMenu }: { onMenu(): void }) {
  const { pathname } = useLocation();
  const title = TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Admin';

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn menu-btn"
        aria-label="Open menu"
        onClick={onMenu}
      >
        <Menu size={20} />
      </button>
      <h1>{title}</h1>
      <span className="topbar-hint">Local image storage · Session protected</span>
    </header>
  );
}
