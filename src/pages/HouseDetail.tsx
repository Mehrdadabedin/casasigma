import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { houses } from '../data/houses';
import { useBookings } from '../state/BookingsProvider';
import { useI18n } from '../state/LanguageProvider';
import { Photo } from '../components/Photo';
import { DayPicker, TimeSlots } from '../components/pickers';
import { Rating } from '../components/cards';
import {
  AreaIcon,
  ArrowLeftIcon,
  BathIcon,
  BedIcon,
  CheckIcon,
  PinIcon,
} from '../components/icons';
import { formatDay, formatPrice, upcomingDays } from '../lib/format';
import type { Booking } from '../types';

const viewingTimes = ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:30'];
const days = upcomingDays(7);

export function HouseDetail() {
  const { id } = useParams<{ id: string }>();
  const house = houses.find((candidate) => candidate.id === id);
  const { addVisit, isSlotTaken } = useBookings();
  const { t, locale } = useI18n();

  const [day, setDay] = useState(days[0] ?? '');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [visitors, setVisitors] = useState(2);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Booking | null>(null);

  const takenTimes = useMemo(() => {
    if (!house) return new Set<string>();
    return new Set(viewingTimes.filter((slot) => isSlotTaken(house.id, day, slot)));
  }, [house, day, isSlotTaken]);

  if (!house) {
    return (
      <div className="page">
        <p className="eyebrow">{t('house.notFound')}</p>
        <h1>{t('house.notFoundTitle')}</h1>
        <Link className="button" to="/homes">
          {t('house.backAll')}
        </Link>
      </div>
    );
  }

  function chooseDay(nextDay: string) {
    setDay(nextDay);
    setTime('');
    setConfirmed(null);
    setError('');
  }

  function onBook(event: FormEvent) {
    event.preventDefault();
    if (!house) return;
    if (!time) {
      setError(t('house.errorTime'));
      return;
    }
    if (!name.trim()) {
      setError(t('house.errorName'));
      return;
    }
    const visit = addVisit({
      houseId: house.id,
      date: day,
      time,
      name: name.trim(),
      visitors,
      note: note.trim(),
    });
    if (!visit) {
      setError(t('house.errorSlot'));
      setTime('');
      return;
    }
    setError('');
    setConfirmed(visit);
    setName('');
    setNote('');
  }

  return (
    <div className="page detail">
      <Link className="backlink" to="/homes">
        <ArrowLeftIcon width={15} height={15} /> {t('house.all')}
      </Link>

      <div className="detail__gallery">
        <Photo gradient={house.gradient} label={house.title} className="photo--hero" />
        <div className="detail__thumbs">
          <Photo gradient={[house.gradient[1], house.gradient[0]]} className="photo--thumb" />
          <Photo gradient={['#efe7dc', house.gradient[0]]} className="photo--thumb" />
          <Photo gradient={[house.gradient[0], '#f7f1e8']} className="photo--thumb" />
        </div>
        <span className="detail__kind">{house.kind}</span>
      </div>

      <div className="detail__grid">
        <div className="detail__content">
          <div className="detail__titleblock">
            <div>
              <h1>{house.title}</h1>
              <p className="detail__address">
                <PinIcon width={14} height={14} /> {house.address}, {house.neighborhood},{' '}
                {house.city}
              </p>
            </div>
            <div className="detail__price">
              {formatPrice(house.price)}
              <span>{t('house.guidePrice')}</span>
            </div>
          </div>

          <div className="facts">
            <span>
              <BedIcon width={17} height={17} /> {t('unit.bedrooms', { n: house.beds })}
            </span>
            <span>
              <BathIcon width={17} height={17} /> {t('unit.bathrooms', { n: house.baths })}
            </span>
            <span>
              <AreaIcon width={17} height={17} /> {house.area} m²
            </span>
            <span>
              <Rating value={house.rating} count={house.reviewCount} />
            </span>
          </div>

          <section className="block">
            <h2>{t('house.about')}</h2>
            <p className="prose">{house.description}</p>
          </section>

          <section className="block">
            <h2>{t('house.included')}</h2>
            <ul className="chips">
              {house.amenities.map((amenity) => (
                <li key={amenity}>{amenity}</li>
              ))}
            </ul>
          </section>

          <section className="block">
            <h2>{t('house.openHouse')}</h2>
            <div className="infocard">
              <div>
                <strong>{house.openHouse}</strong>
                <p>{t('house.openHouseBody')}</p>
              </div>
              <span className="infocard__tag">{t('house.thisWeek')}</span>
            </div>
          </section>

          <section className="block">
            <h2>{t('house.host')}</h2>
            <div className="agent">
              <span className="agent__avatar" aria-hidden="true">
                {house.agent.name
                  .split(' ')
                  .map((part) => part[0])
                  .join('')}
              </span>
              <div>
                <strong>{house.agent.name}</strong>
                <p>{t('house.hostLine')}</p>
              </div>
              <a className="button button--ghost" href={`tel:${house.agent.phone.replace(/\s/g, '')}`}>
                {t('common.call')}
              </a>
            </div>
          </section>
        </div>

        <aside className="booking" aria-label={t('house.book')}>
          {confirmed ? (
            <div className="booking__success">
              <span className="booking__check">
                <CheckIcon width={20} height={20} />
              </span>
              <h2>{t('house.success')}</h2>
              <p>
                {t('house.successWhen', {
                  when: formatDay(confirmed.date, locale),
                  time: confirmed.time,
                })}{' '}
                ·{' '}
                {t(
                  confirmed.visitors === 1 ? 'unit.visitors.one' : 'unit.visitors.other',
                  { n: confirmed.visitors },
                )}
              </p>
              <p className="booking__small">
                {t('house.successBody', { name: house.agent.name })}
              </p>
              <Link className="button" to="/plans">
                {t('house.seePlans')}
              </Link>
              <button
                type="button"
                className="textlink textlink--center"
                onClick={() => setConfirmed(null)}
              >
                {t('house.another')}
              </button>
            </div>
          ) : (
            <form onSubmit={onBook} className="booking__form">
              <div className="booking__head">
                <h2>{t('house.book')}</h2>
                <span className="booking__free">{t('common.noFee')}</span>
              </div>
              <p className="booking__sub">{t('house.choose', { name: house.agent.name })}</p>

              <DayPicker days={days} selected={day} onSelect={chooseDay} />
              <TimeSlots
                times={viewingTimes}
                selected={time}
                onSelect={(slot) => {
                  setTime(slot);
                  setError('');
                }}
                isTaken={(slot) => takenTimes.has(slot)}
              />

              <label className="field">
                <span>{t('house.yourName')}</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('house.namePlaceholder')}
                  autoComplete="name"
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>{t('house.visitors')}</span>
                  <select
                    value={visitors}
                    onChange={(event) => setVisitors(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {t(count === 1 ? 'unit.people.one' : 'unit.people.other', { n: count })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('house.note')}</span>
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t('house.notePlaceholder')}
                  />
                </label>
              </div>

              {error && (
                <p className="formerror" role="alert">
                  {error}
                </p>
              )}

              <button className="button button--block" type="submit">
                {t('house.request')}
              </button>
              <p className="booking__fine">{t('house.fine')}</p>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
