import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { useI18n } from '../state/LanguageProvider';

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <Link to="/" className="footer__logo" aria-label="CasaSigma home">
            <BrandLogo />
          </Link>
          <p className="footer__tagline">{t('footer.tagline')}</p>
        </div>

        <nav className="footer__col" aria-label={t('footer.explore')}>
          <h2 className="footer__heading">{t('footer.explore')}</h2>
          <Link to="/homes">{t('nav.homes')}</Link>
          <Link to="/restaurants">{t('nav.restaurants')}</Link>
          <Link to="/plans">{t('nav.plans')}</Link>
        </nav>
      </div>

      <div className="footer__bottom">
        <p className="footer__copy">© 2026 CasaSigma</p>
        <p className="footer__fine">{t('footer.rights')}</p>
      </div>
    </footer>
  );
}
