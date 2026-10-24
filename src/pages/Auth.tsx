import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { ApiError, authApi, type Role } from '../lib/api';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from '../components/icons';

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
  /** `forgot` and `reset` are auth screens without the sign-in/sign-up tabs. */
  active: 'login' | 'signup' | 'forgot' | 'reset';
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

          {active === 'login' || active === 'signup' ? (
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
          ) : null}

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
 * the starter password. Sellers land in the studio where listings and their
 * photos live; everyone else lands on the page they asked for.
 */
function landing(user: { role: Role; mustSetPassword: boolean } | null | undefined, next: string) {
  if (user?.role === 'admin') {
    if (user.mustSetPassword) return '/admin/credentials';
    // An admin has no public profile, so “Your profile” must not land on that
    // notice — the dashboard is the only useful destination for them.
    if (next === '/homes' || next === '/profile') return '/admin';
    return next;
  }
  if (user?.role === 'seller' && next === '/homes') return '/sell';
  return next;
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

        <p className="auth__forgot">
          <Link to="/forgot">{t('auth.forgot')}</Link>
        </p>

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
    if (ready && user) navigate(landing(user, next), { replace: true });
  }, [ready, user, next, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const session = await signUp({ name: name.trim(), email: email.trim(), password, role });
      navigate(landing(session, next), { replace: true });
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

/**
 * “Forgot your password?” — mails a single-use link. The API answers 202 for
 * any well-formed address, so this screen never learns whether an account
 * exists; it always moves to the same “check your inbox” state.
 */
export function ForgotPasswordPage() {
  const { t } = useI18n();
  const next = useNextPath();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell active="forgot" title={t('forgot.title')} lede={t('forgot.lede')} next={next}>
      {sent ? (
        <div className="auth__form">
          <div className="auth__sent" role="status">
            <span className="booking__check">
              <CheckIcon width={18} height={18} />
            </span>
            <h2>{t('forgot.sentTitle')}</h2>
            <p>{t('forgot.sentBody')}</p>
          </div>
          <Link className="button button--block" to={withNext('/login', next)}>
            {t('forgot.back')}
          </Link>
        </div>
      ) : (
        <form className="auth__form" onSubmit={onSubmit}>
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

          {error && (
            <p className="formerror" role="alert">
              {error}
            </p>
          )}

          <button className="button button--block" type="submit" disabled={pending}>
            {pending ? t('forgot.sending') : t('forgot.submit')}
            {!pending && <ArrowRightIcon width={16} height={16} />}
          </button>

          <p className="auth__switch">
            <Link to={withNext('/login', next)}>{t('forgot.back')}</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * The landing page for a mailed reset link. The token is in `?token=`; a
 * successful reset signs every device out, so the last step is signing in
 * again with the new password.
 */
export function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 10) {
      setError(t('auth.errorPassword'));
      return;
    }
    if (password !== confirm) {
      setError(t('reset.mismatch'));
      return;
    }
    setPending(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      const stale = caught instanceof ApiError && caught.field === 'token';
      setError(stale ? t('reset.invalid') : errorMessage(caught, t));
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthShell active="reset" title={t('reset.title')} lede={t('reset.missing')}>
        <div className="auth__form">
          <Link className="button button--block" to="/forgot">
            {t('reset.request')}
          </Link>
          <p className="auth__switch">
            <Link to="/login">{t('forgot.back')}</Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell active="reset" title={t('reset.doneTitle')} lede={t('reset.doneBody')}>
        <div className="auth__form">
          <Link className="button button--block" to="/login">
            {t('auth.signIn')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell active="reset" title={t('reset.title')} lede={t('reset.lede')}>
      <form className="auth__form" onSubmit={onSubmit}>
        <label className="field">
          <span>{t('reset.password')}</span>
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

        <label className="field">
          <span>{t('reset.confirm')}</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
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
          {pending ? t('reset.saving') : t('reset.submit')}
          {!pending && <ArrowRightIcon width={16} height={16} />}
        </button>

        <p className="auth__switch">
          <Link to="/forgot">{t('reset.request')}</Link>
        </p>
      </form>
    </AuthShell>
  );
}
