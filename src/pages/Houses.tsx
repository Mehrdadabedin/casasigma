import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { houseCities, houseKinds, houses } from '../data/houses';
import { HouseCard } from '../components/cards';
import { EmptyState } from '../components/pickers';
import { formatPrice } from '../lib/format';
import { useI18n } from '../state/LanguageProvider';

type SortKey = 'recommended' | 'price-asc' | 'price-desc' | 'area-desc';

const maxCataloguePrice = Math.max(...houses.map((house) => house.price));
const minCataloguePrice = Math.min(...houses.map((house) => house.price));

export function Houses() {
  const [params, setParams] = useSearchParams();
  const { t, tp } = useI18n();
  const query = params.get('q') ?? '';
  const city = params.get('city') ?? 'all';
  const kind = params.get('kind') ?? 'all';
  const budget = Number(params.get('max') ?? maxCataloguePrice);
  const sort = (params.get('sort') as SortKey | null) ?? 'recommended';

  const maxPrice = Number.isFinite(budget) ? budget : maxCataloguePrice;

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = houses.filter((house) => {
      const haystack = `${house.title} ${house.city} ${house.neighborhood} ${house.kind} ${house.description} ${house.amenities.join(' ')}`.toLowerCase();
      const matchesQuery = !needle || haystack.includes(needle);
      const matchesCity = city === 'all' || house.city === city;
      const matchesKind = kind === 'all' || house.kind === kind;
      const matchesPrice = house.price <= maxPrice;
      return matchesQuery && matchesCity && matchesKind && matchesPrice;
    });

    switch (sort) {
      case 'price-asc':
        return [...filtered].sort((a, b) => a.price - b.price);
      case 'price-desc':
        return [...filtered].sort((a, b) => b.price - a.price);
      case 'area-desc':
        return [...filtered].sort((a, b) => b.area - a.area);
      default:
        return [...filtered].sort((a, b) => b.rating - a.rating);
    }
  }, [query, city, kind, maxPrice, sort]);

  const hasFilters =
    Boolean(query) || city !== 'all' || kind !== 'all' || maxPrice < maxCataloguePrice;

  return (
    <div className="page">
      <header className="pagehead pagehead--homes">
        <p className="eyebrow">{t('homes.eyebrow')}</p>
        <h1>{t('homes.title')}</h1>
        <p className="pagehead__lede">{t('homes.lede')}</p>
      </header>

      <div className="filters">
        <label className="field field--search">
          <span>{t('filters.search')}</span>
          <input
            value={query}
            onChange={(event) => update('q', event.target.value)}
            placeholder={t('homes.searchPlaceholder')}
          />
        </label>

        <label className="field">
          <span>{t('filters.city')}</span>
          <select value={city} onChange={(event) => update('city', event.target.value)}>
            <option value="all">{t('filters.anyCity')}</option>
            {houseCities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t('filters.type')}</span>
          <select value={kind} onChange={(event) => update('kind', event.target.value)}>
            <option value="all">{t('filters.anyType')}</option>
            {houseKinds.map((option) => (
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
            <option value="area-desc">{t('filters.largest')}</option>
          </select>
        </label>

        <label className="field field--range">
          <span>{t('filters.budgetUpTo', { price: formatPrice(maxPrice) })}</span>
          <input
            type="range"
            min={minCataloguePrice}
            max={maxCataloguePrice}
            step={25_000}
            value={maxPrice}
            onChange={(event) => update('max', event.target.value)}
          />
        </label>
      </div>

      <div className="resultbar">
        <span>{tp('homes.result', results.length)}</span>
        {hasFilters && (
          <button className="textlink" type="button" onClick={() => setParams({}, { replace: true })}>
            {t('common.clearFilters')}
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState
          title={t('homes.emptyTitle')}
          body={t('homes.emptyBody', { n: houses.length, cities: houseCities.length })}
          action={
            <button className="button button--ghost" onClick={() => setParams({}, { replace: true })}>
              {t('common.resetFilters')}
            </button>
          }
        />
      ) : (
        <div className="grid">
          {results.map((house) => (
            <HouseCard key={house.id} house={house} />
          ))}
        </div>
      )}
    </div>
  );
}
