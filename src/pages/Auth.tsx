import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { ApiError, type Role } from '../lib/api';
import { ArrowLeftIcon, ArrowRightIcon } from '../components/icons';

/** Only allow in-app paths, so `?next=` cannot become an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/homes';
  if (raw.startsWith('/login') || raw.startsWith('/signup')) return '/homes';
  return raw;
}

function useNextPath(): string {
  const [params] = useSearchParams();
  return safeNext(params.get('next'));
}

function withNext(path: string, next: string): string {
  return `${path}?next=${encodeURIComponent(next)}`;
}

/** Shared card for the sign-in and sign-up screens. */
export function AuthShell({
  active,
  title,
  lede,
  next = '/homes',
  children,
}: {
  /** Omit on the setup screen, which is not a login/signup tab. */
  active: 'login' | 'signup';
  title: string;
  lede: string;
  next?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className={`page auth auth--${active}`}>
      <div className="auth__card">
        <div className="auth__panel">
          <Link className="backlink" to="/">
            <ArrowLeftIcon width={15} height={15} /> {t('auth.back')}
          </Link>

          <div className="auth__tabs" role="tablist" aria-label={t('auth.eyebrow')}>
            <Link
              role="tab"
              aria-selected={active === 'login'}
              className={`auth__tab ${active === 'login' ? 'is-active' : ''}`}
              to={withNext('/login', next)}
            >
              {t('auth.signInTab')}
            </Link>
            <Link
              role="tab"
              aria-selected={active === 'signup'}
              className={`auth__tab ${active === 'signup' ? 'is-active' : ''}`}
              to={withNext('/signup', next)}
            >
              {t('auth.signUpTab')}
            </Link>
          </div>

          <p className="eyebrow">{t('auth.eyebrow')}</p>
          <h1>{title}</h1>
          <p className="pagehead__lede auth__lede">{lede}</p>
          {children}
        </div>

        <aside className="auth__media" aria-hidden="true">
          <div className="auth__media-copy">
            <p className="eyebrow">CasaSigma</p>
            <h2>{t('auth.mediaTitle')}</h2>
            <p>{t('auth.mediaBody')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function errorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t('auth.errorCredentials');
    if (error.status === 403) return t('auth.errorSuspended');
    if (error.status === 409) return t('auth.errorEmail');
    if (error.status === 429) return t('auth.errorRate');
    if (error.field === 'password') return t('auth.errorPassword');
  }
  return t('auth.errorGeneric');
}

/**
 * Admins land on the dashboard, or on the credential step while they still use
 * the starter password; everyone else lands on the page they asked for.
 */
function landing(user: { role: Role; mustSetPassword: boolean } | null | undefined, next: string) {
  if (user?.role !== 'admin') return next;
  if (user.mustSetPassword) return '/admin/credentials';
  return next === '/homes' ? '/admin' : next;
}

export function LoginPage() {
  const { signIn, user, ready } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const next = useNextPath();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && user) navigate(landing(user, next), { replace: true });
  }, [ready, user, next, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const session = await signIn(identifier.trim(), password);
      navigate(landing(session, next), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      active="login"
      title={t('auth.loginTitle')}
      lede={t('auth.loginLede')}
      next={next}
    >
      <form className="auth__form" onSubmit={onSubmit}>
        <label className="field">
          <span>{t('auth.identifier')}</span>
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            placeholder={t('auth.identifierPlaceholder')}
            required
          />
        </label>

        <label className="field">
          <span>{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder={t('auth.passwordHint')}
            required
          />
        </label>

        {error && (
          <p className="formerror" role="alert">
            {error}
          </p>
        )}

        <button className="button button--block" type="submit" disabled={pending}>
          {pending ? t('auth.signingIn') : t('auth.signIn')}
          {!pending && <ArrowRightIcon width={16} height={16} />}
        </button>

        <p className="auth__switch">
          {t('auth.newHere')} <Link to={withNext('/signup', next)}>{t('auth.createLink')}</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp, user, ready } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const next = useNextPath();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('buyer');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && user) navigate(next, { replace: true });
  }, [ready, user, next, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await signUp({ name: name.trim(), email: email.trim(), password, role });
      navigate(next, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      active="signup"
      title={t('auth.signupTitle')}
      lede={t('auth.signupLede')}
      next={next}
    >
      <form className="auth__form" onSubmit={onSubmit}>
        <div className="auth__roles" role="group" aria-label={t('auth.signupTitle')}>
          {(
            [
              ['buyer', 'auth.roleBuying', 'auth.roleBuyingHint'],
              ['seller', 'auth.roleSelling', 'auth.roleSellingHint'],
            ] as const
          ).map(([value, labelKey, hintKey]) => (
            <button
              key={value}
              type="button"
              className={`auth__role ${role === value ? 'is-active' : ''}`}
              aria-pressed={role === value}
              onClick={() => setRole(value)}
            >
              <strong>{t(labelKey)}</strong>
              <span>{t(hintKey)}</span>
            </button>
          ))}
        </div>

        <label className="field">
          <span>{t('auth.name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder={t('auth.namePlaceholder')}
            minLength={2}
            required
          />
        </label>

        <label className="field">
          <span>{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="field">
          <span>{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={t('auth.passwordHint')}
            minLength={10}
            required
          />
        </label>

        {error && (
          <p className="formerror" role="alert">
            {error}
          </p>
        )}

        <button className="button button--block" type="submit" disabled={pending}>
          {pending ? t('auth.creating') : t('auth.create')}
          {!pending && <ArrowRightIcon width={16} height={16} />}
        </button>

        <p className="auth__switch">
          {t('auth.haveAccount')}{' '}
          <Link to={withNext('/login', next)}>{t('auth.signInLink')}</Link>
        </p>
      </form>
    </AuthShell>
  );
}
