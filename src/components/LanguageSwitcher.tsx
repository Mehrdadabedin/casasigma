import { GlobeIcon } from './icons';
import { locales, type Locale } from '../i18n/messages';
import { useI18n } from '../state/LanguageProvider';

/** The four-code language pill in the header. */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const label = t('language.label');

  return (
    <div className="lang" role="group" aria-label={label} title={label}>
      <GlobeIcon width={14} height={14} />
      {locales.map((option) => {
        const active = option.code === locale;
        return (
          <button
            key={option.code}
            type="button"
            className={`lang__btn ${active ? 'is-active' : ''}`}
            onClick={() => setLocale(option.code)}
            aria-pressed={active}
            title={option.name}
            lang={option.htmlLang}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}

export type { Locale };
