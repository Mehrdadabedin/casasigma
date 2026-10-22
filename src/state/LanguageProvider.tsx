import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { locales, translate, type Locale } from '../i18n/messages';

const STORAGE_KEY = 'casasigma.locale';

function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale.code === value);
}

function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
    const browser = navigator.language.slice(0, 2).toLowerCase();
    if (isLocale(browser)) return browser;
  } catch {
    // Storage can be unavailable; English is the safe default.
  }
  return 'en';
}

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Plural-aware lookup: `tp('homes.result', 3)` uses `homes.result.one/other`. */
  tp: (base: string, count: number) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Non-fatal: the choice simply does not persist.
    }
    const meta = locales.find((candidate) => candidate.code === locale);
    document.documentElement.lang = meta?.htmlLang ?? locale;
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const tp = useCallback(
    (base: string, count: number) => {
      const rule = new Intl.PluralRules(locale).select(count);
      return translate(locale, `${base}.${rule}`, { n: count });
    },
    [locale],
  );

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t, tp }),
    [locale, setLocale, t, tp],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useI18n must be used inside <LanguageProvider>');
  return context;
}
