import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon } from '../components/icons';
import { useI18n } from '../state/LanguageProvider';

/** The landing page: the headline and the search, over the photos in Layout. */
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
        <h1>
          {t('home.titleA')}
          <br />
          {t('home.titleB')}
          <span className="accent">.</span>
        </h1>

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
      </section>
    </div>
  );
}
