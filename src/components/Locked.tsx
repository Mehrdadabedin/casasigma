import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { ArrowLeftIcon, ShieldIcon } from './icons';

/**
 * Listing photos, prices and addresses are for signed-in accounts. Cards and
 * detail pages ask this before rendering: `ready` matters, so a visitor is not
 * shown the unlocked layout while the session is still being checked.
 */
export function useLocked(): boolean {
  const { user, ready } = useAuth();
  return ready && !user;
}

/** `?next=` back to where the person was, so signing in returns them there. */
export function useLoginPath(): string {
  const { pathname, search } = useLocation();
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

/** The pill over a blurred photo. A span, because the card itself is a link. */
export function LockedBadge() {
  const { t } = useI18n();
  return <span className="locked-badge">{t('gate.loginRequired')}</span>;
}

/**
 * The text half of a locked card (MKT1.2). It shows placeholders instead of the
 * real price and address, so a guest's page never holds them, blurred or not.
 */
export function LockedCardBody({ kind, city }: { kind: string; city: string }) {
  const { t } = useI18n();
  return (
    <div className="card__body card__body--locked" aria-hidden="true">
      <div className="card__price">{t('gate.pricePlaceholder')}</div>
      <h3 className="card__title">{t('gate.addressPlaceholder')}</h3>
      <p className="card__meta">
        {kind} · {city}
      </p>
    </div>
  );
}

/**
 * A detail route for a signed-out visitor: the cover blurred out and a panel
 * asking them to sign in. The media is passed in so the caller keeps control of
 * which photograph (or gradient) is behind the blur.
 */
export function LockedDetail({
  media,
  backTo,
  backLabel,
  bookTo,
}: {
  media: ReactNode;
  backTo: string;
  backLabel: string;
  /** Booking a viewing needs no account, so a locked page still links to it. */
  bookTo: string;
}) {
  const { t } = useI18n();
  const loginPath = useLoginPath();

  return (
    <div className="page detail">
      <Link className="backlink" to={backTo}>
        <ArrowLeftIcon width={15} height={15} /> {backLabel}
      </Link>

      <div className="locked-detail">
        <div className="locked-detail__media" aria-hidden="true">
          {media}
        </div>
        <div className="locked-detail__panel">
          <span className="locked-detail__icon">
            <ShieldIcon width={20} height={20} />
          </span>
          <h1>{t('gate.title')}</h1>
          <p>{t('gate.lede')}</p>
          <div className="locked-detail__actions">
            <Link className="button" to={loginPath}>
              {t('gate.cta')}
            </Link>
            <Link className="button button--ghost" to={bookTo}>
              {t('gate.book')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
