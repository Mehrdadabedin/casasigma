import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cuisines, restaurantCities, restaurants } from '../data/restaurants';
import { RestaurantCard } from '../components/cards';
import { EmptyState } from '../components/pickers';
import { useI18n } from '../state/LanguageProvider';

type SortKey = 'recommended' | 'price-asc' | 'price-desc' | 'seats-desc';

export function Restaurants() {
  const [params, setParams] = useSearchParams();
  const { t, tp } = useI18n();
  const query = params.get('q') ?? '';
  const cuisine = params.get('cuisine') ?? 'all';
  const city = params.get('city') ?? 'all';
  const sort = (params.get('sort') as SortKey | null) ?? 'recommended';

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = restaurants.filter((restaurant) => {
      const haystack =
        `${restaurant.name} ${restaurant.cuisine} ${restaurant.city} ${restaurant.neighborhood} ${restaurant.blurb} ${restaurant.description} ${restaurant.tenure} ${restaurant.features.join(' ')}`.toLowerCase();
      const matchesQuery = !needle || haystack.includes(needle);
      const matchesCuisine = cuisine === 'all' || restaurant.cuisine === cuisine;
      const matchesCity = city === 'all' || restaurant.city === city;
      return matchesQuery && matchesCuisine && matchesCity;
    });

    switch (sort) {
      case 'price-asc':
        return [...filtered].sort((a, b) => a.price - b.price);
      case 'price-desc':
        return [...filtered].sort((a, b) => b.price - a.price);
      case 'seats-desc':
        return [...filtered].sort((a, b) => b.seats - a.seats);
      default:
        return [...filtered].sort((a, b) => b.rating - a.rating);
    }
  }, [query, cuisine, city, sort]);

  const hasFilters = Boolean(query) || cuisine !== 'all' || city !== 'all';

  return (
    <div className="page">
      <header className="pagehead pagehead--restaurants">
        <p className="eyebrow">{t('restaurants.eyebrow')}</p>
        <h1>{t('restaurants.title')}</h1>
        <p className="pagehead__lede">{t('restaurants.lede')}</p>
      </header>

      <div className="filters">
        <label className="field field--search">
          <span>{t('filters.search')}</span>
          <input
            value={query}
            onChange={(event) => update('q', event.target.value)}
            placeholder={t('restaurants.searchPlaceholder')}
          />
        </label>

        <label className="field">
          <span>{t('filters.cuisine')}</span>
          <select value={cuisine} onChange={(event) => update('cuisine', event.target.value)}>
            <option value="all">{t('filters.anyCuisine')}</option>
            {cuisines.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t('filters.city')}</span>
          <select value={city} onChange={(event) => update('city', event.target.value)}>
            <option value="all">{t('filters.anyCity')}</option>
            {restaurantCities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t('filters.sort')}</span>
          <select value={sort} onChange={(event) => update('sort', event.target.value)}>
            <option value="recommended">{t('filters.recommended')}</option>
            <option value="price-asc">{t('filters.priceAsc')}</option>
            <option value="price-desc">{t('filters.priceDesc')}</option>
            <option value="seats-desc">{t('filters.seatsDesc')}</option>
          </select>
        </label>
      </div>

      <div className="resultbar">
        <span>{tp('restaurants.result', results.length)}</span>
        {hasFilters && (
          <button className="textlink" type="button" onClick={() => setParams({}, { replace: true })}>
            {t('common.clearFilters')}
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState
          title={t('restaurants.emptyTitle')}
          body={t('restaurants.emptyBody')}
          action={
            <button className="button button--ghost" onClick={() => setParams({}, { replace: true })}>
              {t('common.resetFilters')}
            </button>
          }
        />
      ) : (
        <div className="grid grid--tables">
          {results.map((restaurant) => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      )}
    </div>
  );
}
