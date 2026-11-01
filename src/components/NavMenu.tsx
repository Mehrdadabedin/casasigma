import { useEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MenuIcon, type IconProps } from './icons';
import { useI18n } from '../state/LanguageProvider';

export type NavItem = { to: string; key: string; Icon: ComponentType<IconProps>; end: boolean };

/**
 * The hamburger button and the site's links, on every screen size. It closes on
 * a new page, on Escape (focus back on the button) and on a tap outside.
 */
export function NavMenu({ links }: { links: NavItem[] }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="navmenu" ref={root}>
      <button
        ref={button}
        type="button"
        className="navmenu__button"
        aria-label={t('nav.menu')}
        aria-expanded={open}
        aria-controls="navmenu-links"
        onClick={() => setOpen((current) => !current)}
      >
        <MenuIcon width={26} height={26} />
      </button>
      {open && (
        <nav id="navmenu-links" className="navmenu__panel" aria-label={t('nav.primary')}>
          {links.map(({ to, key, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `navmenu__link ${isActive ? 'is-active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <Icon width={18} height={18} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
