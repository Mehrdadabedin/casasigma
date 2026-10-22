import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { houses } from '../data/houses';
import { restaurants } from '../data/restaurants';
import { HouseCard, RestaurantCard } from '../components/cards';
import { ArrowRightIcon, PinIcon } from '../components/icons';
import { useI18n } from '../state/LanguageProvider';

export function Home() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { t } = useI18n();

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/homes?q=${encodeURIComponent(trimmed)}` : '/homes');
  }

  return (
    <div className="page page--home">
      <section className="hero">
        <p className="eyebrow">
          <PinIcon width={13} height={13} /> {t('home.eyebrow')}
        </p>
        <h1>
          {t('home.titleA')}
          <br />
          {t('home.titleB')}
          <span className="accent">.</span>
        </h1>
        <p className="hero__lede">{t('home.lede')}</p>

        <form className="search" onSubmit={onSearch} role="search">
          <input
            className="search__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('home.searchAria')}
          />
          <button className="search__button" type="submit">
            {t('home.searchButton')}
            <ArrowRightIcon width={16} height={16} />
          </button>
        </form>

        <div className="hero__stats">
          <div>
            <strong>{houses.length}</strong>
            <span>{t('home.statHomes')}</span>
          </div>
          <div>
            <strong>{restaurants.length}</strong>
            <span>{t('home.statRestaurants')}</span>
          </div>
          <div>
            <strong>{new Set([...houses, ...restaurants].map((listing) => listing.city)).size}</strong>
            <span>{t('home.statTowns')}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <div>
            <h2>{t('home.openTitle')}</h2>
            <p>{t('home.openSub')}</p>
          </div>
          <Link className="textlink" to="/homes">
            {t('home.openLink')} <ArrowRightIcon width={14} height={14} />
          </Link>
        </div>
        <div className="rail">
          {houses.slice(0, 4).map((house) => (
            <HouseCard key={house.id} house={house} compact />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <div>
            <h2>{t('home.restTitle')}</h2>
            <p>{t('home.restSub')}</p>
          </div>
          <Link className="textlink" to="/restaurants">
            {t('home.restLink')} <ArrowRightIcon width={14} height={14} />
          </Link>
        </div>
        <div className="rail">
          {restaurants.slice(0, 3).map((restaurant) => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} compact />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="how">
          <h2>{t('home.howTitle')}</h2>
          <ol className="how__list">
            <li>
              <span className="how__num">01</span>
              <div>
                <h3>{t('home.how1Title')}</h3>
                <p>{t('home.how1Body')}</p>
              </div>
            </li>
            <li>
              <span className="how__num">02</span>
              <div>
                <h3>{t('home.how2Title')}</h3>
                <p>{t('home.how2Body')}</p>
              </div>
            </li>
            <li>
              <span className="how__num">03</span>
              <div>
                <h3>{t('home.how3Title')}</h3>
                <p>{t('home.how3Body')}</p>
              </div>
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
