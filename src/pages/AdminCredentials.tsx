import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { ApiError, type SessionUser } from '../lib/api';
import { ArrowLeftIcon, ArrowRightIcon } from '../components/icons';

function CredentialForm({ admin }: { admin: SessionUser }) {
  const { updateAdminCredentials } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [username, setUsername] = useState(admin.username ?? 'admin2');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  function problem(caught: unknown): string {
    if (caught instanceof ApiError) {
      if (caught.field === 'currentPassword' || caught.status === 401) return t('cred.errorCurrent');
      if (caught.field === 'username') {
        return caught.status === 409 ? t('cred.errorTaken') : t('cred.errorUsername');
      }
      if (caught.field === 'password') return t('cred.errorPassword');
    }
    return t('cred.errorGeneric');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError(t('cred.errorMismatch'));
      return;
    }
    setError('');
    setPending(true);
    try {
      await updateAdminCredentials({ currentPassword, username: username.trim(), password });
      navigate('/admin', { replace: true });
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adm__panel cred__form" onSubmit={onSubmit}>
      <label className="field">
        <span>{t('cred.current')}</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          placeholder={admin.mustSetPassword ? t('cred.currentStarter') : t('cred.currentHint')}
          required
        />
      </label>

      <label className="field">
        <span>{t('cred.username')}</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          minLength={2}
          maxLength={32}
          spellCheck={false}
          required
        />
      </label>

      <label className="field">
        <span>{t('cred.password')}</span>
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
        <span>{t('cred.confirm')}</span>
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
        {pending ? t('cred.submitting') : t('cred.submit')}
        {!pending && <ArrowRightIcon width={16} height={16} />}
      </button>
    </form>
  );
}

/**
 * The seeded admin signs in with a public starter password and lands here to
 * replace it. The same form works later as a change-password screen.
 */
export function AdminCredentialsPage() {
  const { user, ready } = useAuth();
  const { t } = useI18n();

  if (!ready) {
    return <p className="page page--narrow admin__loading">{t('admin.loading')}</p>;
  }
  if (!user) return <Navigate to="/login?next=/admin/credentials" replace />;
  if (user.role !== 'admin') return <Navigate to="/admin" replace />;

  return (
    <div className="page page--narrow cred">
      {/* During the first-run step the dashboard is closed, so no way back. */}
      {!user.mustSetPassword && (
        <Link className="backlink" to="/admin">
          <ArrowLeftIcon width={15} height={15} /> {t('cred.back')}
        </Link>
      )}

      <p className="eyebrow">{t('cred.eyebrow')}</p>
      <h1>{t('cred.title')}</h1>
      <p className="pagehead__lede">{user.mustSetPassword ? t('cred.ledeFirst') : t('cred.lede')}</p>

      <CredentialForm admin={user} />
    </div>
  );
}
