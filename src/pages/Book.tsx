import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { houses } from '../data/houses';
import { restaurants } from '../data/restaurants';
import { useBookings } from '../state/BookingsProvider';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { ListingPhoto, Photo } from '../components/Photo';
import { DayPicker, TimeSlots } from '../components/pickers';
import { CalendarIcon, CheckIcon } from '../components/icons';
import { formatBookedAt, formatDay, upcomingDays } from '../lib/format';
import { ApiError, listingApi, viewingApi, type Listing, type ViewingRequest } from '../lib/api';

const viewingTimes = ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:30'];
const days = upcomingDays(14);

/**
 * Listing ids carry their kind so /book can turn a stored id back into a
 * working link: `house:casa-do-fogo`, `restaurant:...` or `listing:<uuid>`.
 */
function listingLink(listingId: string): string | null {
  const [kind, id] = listingId.split(':');
  if (kind === 'house' && id) return `/homes/${id}`;
  if (kind === 'restaurant' && id) return `/restaurants/${id}`;
  if (kind === 'listing' && id) return `/listings/${id}`;
  return null;
}

function gradientFor(listingId: string): [string, string] | null {
  const [kind, id] = listingId.split(':');
  const match =
    kind === 'house'
      ? houses.find((house) => house.id === id)
      : kind === 'restaurant'
        ? restaurants.find((restaurant) => restaurant.id === id)
        : undefined;
  return match ? match.gradient : null;
}

export function Book() {
  const { bookings, cancelBooking } = useBookings();
  const { user } = useAuth();
  const { t, locale } = useI18n();

  // Links look like /book?listing=<uuid> (seller listing) or ?listing=house:<id>.
  const [params] = useSearchParams();
  const requested = params.get('listing');
  const [live, setLive] = useState<Listing[]>([]);

  const [listing, setListing] = useState(() =>
    requested ? (requested.includes(':') ? requested : `listing:${requested}`) : `house:${houses[0]?.id ?? ''}`,
  );
  const [day, setDay] = useState(days[0] ?? '');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<ViewingRequest | null>(null);
  const [requests, setRequests] = useState<ViewingRequest[] | null>(null);

  // Signing in fills the contact fields; anything typed first is kept.
  useEffect(() => {
    if (!user) return;
    setName((current) => current || user.name);
    setEmail((current) => current || user.email);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setRequests(null);
      return;
    }
    let alive = true;
    viewingApi
      .list()
      .then((rows) => {
        if (alive) setRequests(rows);
      })
      .catch(() => {
        if (alive) setRequests([]);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const saved = useMemo(
    () =>
      [...bookings].sort((a, b) =>
        `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`),
      ),
    [bookings],
  );

  useEffect(() => {
    let alive = true;
    listingApi
      .list()
      .then((rows) => {
        if (alive) setLive(rows);
      })
      .catch(() => {
        // Without the list a deep link cannot resolve; fall back to the catalogue.
        if (alive && requested) setListing(`house:${houses[0]?.id ?? ''}`);
      });
    return () => {
      alive = false;
    };
  }, [requested]);

  // A listing that has disappeared (or a bad link) falls back to the catalogue.
  useEffect(() => {
    if (!listing.startsWith('listing:') || live.length === 0) return;
    const id = listing.slice('listing:'.length);
    if (!live.some((row) => row.id === id)) setListing(`house:${houses[0]?.id ?? ''}`);
  }, [listing, live]);

  const liveById = useMemo(() => new Map(live.map((row) => [row.id, row])), [live]);

  const listingTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const house of houses) map.set(`house:${house.id}`, house.title);
    for (const restaurant of restaurants) map.set(`restaurant:${restaurant.id}`, restaurant.name);
    for (const row of live) map.set(`listing:${row.id}`, row.title);
    return map;
  }, [live]);

  /** Cover photo of a seller listing, for the request thumbnails. */
  function livePhoto(listingId: string): string | null {
    const [kind, id] = listingId.split(':');
    if (kind !== 'listing' || !id) return null;
    return liveById.get(id)?.photos[0]?.slug ?? null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const listingTitle = listingTitles.get(listing);
    if (!listingTitle) {
      setError(t('book.errorListing'));
      return;
    }
    if (name.trim().length < 2) {
      setError(t('book.errorName'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError(t('book.errorEmail'));
      return;
    }
    if (!day) {
      setError(t('book.errorDate'));
      return;
    }
    if (!time) {
      setError(t('book.errorTime'));
      return;
    }

    setError('');
    setPending(true);
    try {
      const request = await viewingApi.create({
        listingId: listing,
        listingTitle,
        name: name.trim(),
        email: email.trim(),
        description: description.trim(),
        date: day,
        time,
      });
      setSent(request);
      setRequests((current) => (current ? [request, ...current] : [request]));
      setDescription('');
      setTime('');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.message ? caught.message : t('book.errorGeneric'),
      );
    } finally {
      setPending(false);
    }
  }

  async function cancelSent(request: ViewingRequest) {
    try {
      const updated = await viewingApi.cancel(request.id);
      setRequests((current) =>
        current ? current.map((row) => (row.id === updated.id ? updated : row)) : current,
      );
    } catch {
      setError(t('book.errorGeneric'));
    }
  }

  return (
    <div className="page">
      <header className="pagehead pagehead--plans">
        <p className="eyebrow">{t('book.eyebrow')}</p>
        <h1>{t('book.title')}</h1>
        <p className="pagehead__lede">{t('book.lede')}</p>
      </header>

      <section className="booknow" aria-label={t('book.formTitle')}>
        {sent ? (
          <div className="booknow__sent">
            <span className="booking__check">
              <CheckIcon width={20} height={20} />
            </span>
            <h2>{t('book.successTitle')}</h2>
            <p>
              {t('book.successBody', {
                title: sent.listingTitle,
                when: formatDay(sent.date, locale),
                time: sent.time,
              })}
            </p>
            <p className="booking__small">{t('book.successEmail', { email: sent.email })}</p>
            <div className="empty__actions">
              <button className="button" type="button" onClick={() => setSent(null)}>
                {t('book.again')}
              </button>
              {listingLink(sent.listingId) && (
                <Link className="button button--ghost" to={listingLink(sent.listingId) ?? '/'}>
                  {t('common.viewListing')}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <form className="bookform" onSubmit={onSubmit} noValidate>
            <div className="bookform__main">
              <div className="bookform__head">
                <h2>{t('book.formTitle')}</h2>
                <p>{t('book.formSub')}</p>
              </div>

              <label className="field">
                <span>{t('book.listing')}</span>
                <select value={listing} onChange={(event) => setListing(event.target.value)}>
                  <optgroup label={t('book.homesGroup')}>
                    {houses.map((house) => (
                      <option key={house.id} value={`house:${house.id}`}>
                        {house.title} · {house.city}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('book.restaurantsGroup')}>
                    {restaurants.map((restaurant) => (
                      <option key={restaurant.id} value={`restaurant:${restaurant.id}`}>
                        {restaurant.name} · {restaurant.city}
                      </option>
                    ))}
                  </optgroup>
                  {live.length > 0 && (
                    <optgroup label={t('book.liveGroup')}>
                      {live.map((row) => (
                        <option key={row.id} value={`listing:${row.id}`}>
                          {row.title} · {row.city}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>

              <div className="field-row">
                <label className="field">
                  <span>{t('book.name')}</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder={t('book.namePlaceholder')}
                    minLength={2}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t('book.email')}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </label>
              </div>

              <label className="field">
                <span>{t('book.description')}</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t('book.descriptionPlaceholder')}
                  rows={4}
                  maxLength={2000}
                />
              </label>
            </div>

            <div className="bookform__when">
              <p className="bookform__label">{t('book.when')}</p>
              <DayPicker
                days={days}
                selected={day}
                onSelect={(next) => {
                  setDay(next);
                  setTime('');
                  setError('');
                }}
              />
              <TimeSlots
                times={viewingTimes}
                selected={time}
                onSelect={(slot) => {
                  setTime(slot);
                  setError('');
                }}
                isTaken={() => false}
              />

              {error && (
                <p className="formerror" role="alert">
                  {error}
                </p>
              )}

              <button className="button button--block" type="submit" disabled={pending}>
                {pending ? t('book.submitting') : t('book.submit')}
              </button>
              <p className="booking__fine">{t('book.fine')}</p>
              {!user && <p className="book__hint">{t('book.guestHint')}</p>}
            </div>
          </form>
        )}
      </section>

      {user && (
        <section className="block">
          <div className="section__head">
            <h2>{t('book.sentTitle')}</h2>
            <p>{t('book.sentSub')}</p>
          </div>

          {requests === null ? (
            <p className="book__hint">{t('admin.loading')}</p>
          ) : requests.length === 0 ? (
            <p className="book__hint">{t('book.sentEmpty')}</p>
          ) : (
            <ul className="plans">
              {requests.map((request) => {
                const gradient = gradientFor(request.listingId);
                const photo = livePhoto(request.listingId);
                const link = listingLink(request.listingId);
                const cancelled = request.status === 'Cancelled';
                return (
                  <li
                    key={request.id}
                    className={`plancard ${cancelled ? 'is-cancelled' : ''}`}
                  >
                    <div className="plancard__thumb">
                      {gradient ? (
                        <Photo gradient={gradient} label={request.listingTitle} />
                      ) : photo ? (
                        <ListingPhoto slug={photo} alt={request.listingTitle} />
                      ) : (
                        <span className="plancard__thumb-empty">
                          <CalendarIcon width={22} height={22} />
                        </span>
                      )}
                    </div>
                    <div className="plancard__body">
                      <div className="plancard__top">
                        <span className="plancard__kind">{t('plans.viewing')}</span>
                        <span className={`pill pill--${request.status.toLowerCase()}`}>
                          {t(`status.${request.status}`)}
                        </span>
                      </div>
                      <h3>{request.listingTitle}</h3>
                      <p className="plancard__when">
                        <CalendarIcon width={14} height={14} />
                        {formatDay(request.date, locale)} · {request.time}
                      </p>
                      {request.description && (
                        <p className="plancard__note">“{request.description}”</p>
                      )}
                      <p className="plancard__meta">
                        {t('plans.requestedBy', {
                          name: request.name,
                          when: formatBookedAt(request.createdAt, locale),
                        })}
                      </p>
                    </div>
                    <div className="plancard__actions">
                      {link && (
                        <Link className="button button--ghost button--small" to={link}>
                          {t('common.viewListing')}
                        </Link>
                      )}
                      {!cancelled && (
                        <button
                          className="textlink textlink--danger"
                          type="button"
                          onClick={() => void cancelSent(request)}
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
        </section>
      )}

      {saved.length > 0 && (
        <section className="block">
          <div className="section__head">
            <h2>{t('book.localTitle')}</h2>
            <p>{t('book.localSub')}</p>
          </div>

          <ul className="plans">
            {saved.map((booking) => {
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
                    <Link
                      className="button button--ghost button--small"
                      to={`/homes/${booking.houseId}`}
                    >
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
          <p className="plans__footnote">{t('plans.footnote')}</p>
        </section>
      )}
    </div>
  );
}
