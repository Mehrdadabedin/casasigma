import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { houses } from '../data/houses';
import { useBookings } from '../state/BookingsProvider';
import { Photo } from '../components/Photo';
import { EmptyState } from '../components/pickers';
import { CalendarIcon } from '../components/icons';
import { formatBookedAt, formatDay } from '../lib/format';
import { useI18n } from '../state/LanguageProvider';

export function Plans() {
  const { bookings, cancelBooking } = useBookings();
  const { t, tp, locale } = useI18n();

  const visible = useMemo(
    () =>
      [...bookings].sort((a, b) =>
        `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`),
      ),
    [bookings],
  );

  const activeCount = bookings.filter((booking) => booking.status !== 'Cancelled').length;

  return (
    <div className="page">
      <header className="pagehead pagehead--plans">
        <p className="eyebrow">{t('plans.eyebrow')}</p>
        <h1>{activeCount === 0 ? t('plans.none') : tp('plans.title', activeCount)}</h1>
        <p className="pagehead__lede">{t('plans.lede')}</p>
      </header>

      {visible.length === 0 ? (
        <EmptyState
          title={t('plans.emptyTitle')}
          body={t('plans.emptyBody')}
          action={
            <Link className="button" to="/homes">
              {t('plans.browse')}
            </Link>
          }
        />
      ) : (
        <ul className="plans">
          {visible.map((booking) => {
            const house = houses.find((candidate) => candidate.id === booking.houseId);
            if (!house) return null;
            const cancelled = booking.status === 'Cancelled';

            return (
              <li key={booking.id} className={`plancard ${cancelled ? 'is-cancelled' : ''}`}>
                <div className="plancard__thumb">
                  <Photo gradient={house.gradient} label={house.title} />
                </div>
                <div className="plancard__body">
                  <div className="plancard__top">
                    <span className="plancard__kind">{t('plans.viewing')}</span>
                    <span className={`pill pill--${booking.status.toLowerCase()}`}>
                      {t(`status.${booking.status}`)}
                    </span>
                  </div>
                  <h3>{house.title}</h3>
                  <p className="plancard__when">
                    <CalendarIcon width={14} height={14} />
                    {formatDay(booking.date, locale)} · {booking.time}
                    <span className="plancard__dot">·</span>
                    {t(
                      booking.visitors === 1 ? 'unit.visitors.one' : 'unit.visitors.other',
                      { n: booking.visitors },
                    )}
                  </p>
                  <p className="plancard__place">
                    {house.neighborhood}, {house.city}
                  </p>
                  {booking.note && <p className="plancard__note">“{booking.note}”</p>}
                  <p className="plancard__meta">
                    {t('plans.requestedBy', {
                      name: booking.name,
                      when: formatBookedAt(booking.createdAt, locale),
                    })}
                  </p>
                </div>
                <div className="plancard__actions">
                  <Link className="button button--ghost button--small" to={`/homes/${booking.houseId}`}>
                    {t('common.viewListing')}
                  </Link>
                  {!cancelled && (
                    <button
                      className="textlink textlink--danger"
                      onClick={() => cancelBooking(booking.id)}
                      type="button"
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="plans__footnote">{t('plans.footnote')}</p>
    </div>
  );
}
