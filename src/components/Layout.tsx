import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { Footer } from './Footer';
import { HomeSlides } from './HomeSlides';
import { LanguageSwitcher } from './LanguageSwitcher';
import {
  CalendarIcon,
  CompassIcon,
  ForkIcon,
  HomeIcon,
  ShieldIcon,
  TagIcon,
  UserIcon,
} from './icons';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';

const tabs = [
  { to: '/', key: 'nav.explore', Icon: CompassIcon, end: true },
  { to: '/homes', key: 'nav.homes', Icon: HomeIcon, end: false },
  { to: '/restaurants', key: 'nav.restaurants', Icon: ForkIcon, end: false },
  { to: '/book', key: 'nav.book', Icon: CalendarIcon, end: false },
];

const sellTab = { to: '/sell', key: 'nav.sell', Icon: TagIcon, end: false };
const adminTab = { to: '/admin', key: 'nav.admin', Icon: ShieldIcon, end: false };

const roleLabel: Record<string, string> = {
  buyer: 'account.buying',
  seller: 'account.selling',
  admin: 'account.admin',
};

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isHome = pathname === '/';
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const { user, ready, signOut } = useAuth();
  const { t } = useI18n();
  // Admins get the dashboard in place of the studio tab — they review the
  // queue rather than publish, and it gives them a way back after leaving the
  // page. Sellers get the studio tab, which is where a listing (and its town)
  // is added. The /admin route and /api/admin/* still answer 401/403
  // regardless of the UI.
  const links =
    user?.role === 'admin'
      ? [...tabs.slice(0, 3), adminTab, tabs[3]]
      : user?.canSell
        ? [...tabs.slice(0, 3), sellTab, tabs[3]]
        : tabs;

  return (
    <div className={`app ${isHome ? 'app--home' : ''}`}>
      <ScrollToTop />
      {isHome && <HomeSlides />}
      <header className={`topbar ${isHome ? 'topbar--home' : ''}`}>
        <div className="topbar__inner">
          <Link to="/" className="brand" aria-label="CasaSigma home">
            <BrandLogo />
          </Link>
          <nav className="topbar__nav" aria-label={t('nav.primary')}>
            {links.slice(1).map(({ to, key, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `topbar__link ${isActive ? 'is-active' : ''}`}
              >
                <Icon width={16} height={16} />
                {t(key)}
              </NavLink>
            ))}
          </nav>

          <LanguageSwitcher />

          <div className="topbar__account">
            {isAuthPage || !ready ? null : user ? (
              <>
                <span className={`topbar__role topbar__role--${user.role}`}>
                  {t(roleLabel[user.role] ?? 'account.buying')}
                </span>
                {/* The admin badge already names the account, so the name would
                    read as “Admin Admin”. Everyone else gets a profile link. */}
                {user.role === 'admin' ? null : (
                  <Link className="topbar__name" to="/profile" title={t('profile.link')}>
                    {user.name.split(' ')[0]}
                  </Link>
                )}
                <button
                  className="topbar__signout"
                  type="button"
                  onClick={() => {
                    void signOut();
                  }}
                >
                  {t('account.signOut')}
                </button>
              </>
            ) : (
              <Link
                className="button button--ghost button--small topbar__signin"
                to="/login"
                aria-label={t('account.signIn')}
              >
                <UserIcon width={15} height={15} />
                <span className="topbar__signin-label">{t('account.signIn')}</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="main">{children}</main>

      <Footer />

      <nav className="tabbar" aria-label={t('nav.sections')}>
        {links.map(({ to, key, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `tabbar__tab ${isActive ? 'is-active' : ''}`}
          >
            <Icon width={22} height={22} />
            <span>{t(key)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
