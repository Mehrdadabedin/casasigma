import { Link } from 'react-router-dom';
import type { House, Restaurant } from '../types';
import { formatPrice } from '../lib/format';
import { BedIcon, BathIcon, AreaIcon, PinIcon, StarIcon } from './icons';
import { Photo } from './Photo';
import { useI18n } from '../state/LanguageProvider';

export function Rating({ value, count }: { value: number; count?: number }) {
  return (
    <span className="rating">
      <StarIcon width={13} height={13} />
      <strong>{value.toFixed(1)}</strong>
      {count !== undefined && <span className="rating__count">({count})</span>}
    </span>
  );
}

export function HouseCard({ house, compact = false }: { house: House; compact?: boolean }) {
  const { t } = useI18n();

  return (
    <Link to={`/homes/${house.id}`} className={`card ${compact ? 'card--compact' : ''}`}>
      <div className="card__media">
        <Photo gradient={house.gradient} label={house.title} />
        <span className="card__kind">{house.kind}</span>
        <span className="card__rating">
          <Rating value={house.rating} />
        </span>
      </div>
      <div className="card__body">
        <div className="card__price">
          {formatPrice(house.price)}
          <span className="card__muted"> {t('price.guide')}</span>
        </div>
        <h3 className="card__title">{house.title}</h3>
        <p className="card__meta">
          <PinIcon width={13} height={13} />
          {house.neighborhood}, {house.city}
        </p>
        <div className="card__specs">
          <span>
            <BedIcon width={14} height={14} /> {t('unit.bedsShort', { n: house.beds })}
          </span>
          <span>
            <BathIcon width={14} height={14} /> {t('unit.bathsShort', { n: house.baths })}
          </span>
          <span>
            <AreaIcon width={14} height={14} /> {house.area} m²
          </span>
        </div>
      </div>
    </Link>
  );
}

export function RestaurantCard({
  restaurant,
  compact = false,
}: {
  restaurant: Restaurant;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Link
      to={`/restaurants/${restaurant.id}`}
      className={`card ${compact ? 'card--compact' : ''}`}
    >
      <div className="card__media card__media--table">
        <Photo gradient={restaurant.gradient} label={restaurant.name} />
        <span className="card__kind">{restaurant.cuisine}</span>
        <span className="card__rating">
          <Rating value={restaurant.rating} count={restaurant.reviewCount} />
        </span>
      </div>
      <div className="card__body">
        <div className="card__price">
          {formatPrice(restaurant.price)}
          <span className="card__muted"> {t('price.asking')}</span>
        </div>
        <h3 className="card__title">{restaurant.name}</h3>
        <p className="card__meta">
          <PinIcon width={13} height={13} />
          {restaurant.neighborhood}, {restaurant.city}
        </p>
        <div className="card__specs">
          <span>{t('card.seats', { n: restaurant.seats })}</span>
          <span>{t(`tenure.${restaurant.tenure}`)}</span>
        </div>
        <p className="card__blurb">{restaurant.blurb}</p>
      </div>
    </Link>
  );
}
