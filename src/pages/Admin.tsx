import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ApiError,
  adminApi,
  type AdminStats,
  type PhotoQueueItem,
  type SessionUser,
} from '../lib/api';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';

function formatJoined(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

function Forbidden() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  // Signing out first matters: sending a signed-in non-admin to /login would
  // bounce straight back here through the login page's redirect.
  async function switchAccount() {
    await signOut();
    navigate('/login?next=/admin', { replace: true });
  }

  return (
    <div className="page page--narrow">
      <p className="eyebrow">403</p>
      <h1>{t('admin.forbiddenTitle')}</h1>
      <p className="pagehead__lede">{t('admin.forbiddenBody')}</p>
      <div className="empty__actions">
        <Link className="button" to="/homes">
          {t('notFound.browse')}
        </Link>
        <button className="button button--ghost" type="button" onClick={() => void switchAccount()}>
          {t('admin.switchAccount')}
        </button>
      </div>
    </div>
  );
}

/**
 * Portrait approval queue. Nothing here is public until the status flips to
 * approved; the API enforces the same rule, not just this screen.
 */
function PhotoReview() {
  const { t, locale } = useI18n();
  const [photos, setPhotos] = useState<PhotoQueueItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    adminApi
      .photos()
      .then((rows) => {
        if (alive) setPhotos(rows);
      })
      .catch((caught) => {
        if (!alive) return;
        setPhotos([]);
        setError(
          caught instanceof ApiError && caught.status === 403
            ? t('admin.forbiddenBody')
            : t('admin.photosLoadError'),
        );
      });
    return () => {
      alive = false;
    };
  }, [t]);

  async function review(photo: PhotoQueueItem, status: 'approved' | 'rejected') {
    if (busy) return;
    setError('');
    setBusy(photo.id);
    try {
      const updated = await adminApi.reviewPhoto(photo.id, status);
      setPhotos((current) =>
        current ? current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)) : current,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('admin.photoSaveError'));
    } finally {
      setBusy(null);
    }
  }

  const pending = photos?.filter((photo) => photo.photoStatus === 'pending').length ?? 0;

  return (
    <section className="adm__panel" aria-label={t('admin.photosHeading')}>
      <div className="adm__panel-head">
        <div>
          <h2>{t('admin.photosHeading')}</h2>
          <p className="adm__note adm__note--tight">{t('admin.photosLede')}</p>
        </div>
        <p className="adm__count" aria-live="polite">
          {photos === null ? t('admin.loading') : t('admin.photosPending', { n: pending })}
        </p>
      </div>

      {error && (
        <p className="formerror" role="alert">
          {error}
        </p>
      )}

      {photos !== null && photos.length === 0 && (
        <p className="adm__empty">{t('admin.photosEmpty')}</p>
      )}

      <ul className="adm__list">
        {(photos ?? []).map((photo) => {
          const working = busy === photo.id;
          return (
            <li key={photo.id} className={`adm__row photo__row is-${photo.photoStatus}`}>
              <div className="photo__who">
                <img
                  className="photo__thumb"
                  src={`api/media/${photo.photoSlug}`}
                  alt={`${t('admin.photosHeading')}: ${photo.displayName}`}
                  width={56}
                  height={56}
                  loading="lazy"
                />
                <div className="adm__who">
                  <strong>{photo.displayName}</strong>
                  <span className="adm__email">{photo.accountEmail}</span>
                  <span className="adm__meta">
                    {t('admin.photosSubmitted', {
                      date: formatJoined(photo.submittedAt ?? new Date().toISOString(), locale),
                    })}
                  </span>
                </div>
              </div>

              <div className="adm__badges">
                <span className={`adm__role adm__role--${photo.kind}`}>
                  {t(`admin.role.${photo.kind}`)}
                </span>
                <span className={`pill pill--${photo.photoStatus}`}>
                  {t(`photo.${photo.photoStatus}`)}
                </span>
              </div>

              <div className="adm__actions">
                <button
                  type="button"
                  className="adm__action adm__action--on"
                  disabled={working || photo.photoStatus === 'approved'}
                  onClick={() => void review(photo, 'approved')}
                >
                  {working ? t('admin.saving') : t('admin.approve')}
                </button>
                <button
                  type="button"
                  className="adm__action adm__action--danger"
                  disabled={working || photo.photoStatus === 'rejected'}
                  onClick={() => void review(photo, 'rejected')}
                >
                  {t('admin.reject')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Dashboard({ admin }: { admin: SessionUser }) {
  const { t, tp, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SessionUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      try {
        const data = await adminApi.users(search);
        setRows(data.users);
        setStats(data.stats);
        setError('');
      } catch (caught) {
        setError(
          caught instanceof ApiError && caught.status === 403
            ? t('admin.forbiddenBody')
            : t('admin.loadError'),
        );
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => void load(query), query ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [query, load]);

  function replaceRow(saved: SessionUser) {
    setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)));
  }

  function adjustStats(delta: Partial<Record<keyof AdminStats, number>>) {
    setStats((current) => {
      if (!current) return current;
      const next = { ...current };
      for (const [key, value] of Object.entries(delta) as [keyof AdminStats, number][]) {
        next[key] = Math.max(0, next[key] + value);
      }
      return next;
    });
  }

  async function toggleSuspended(target: SessionUser) {
    if (busy) return;
    const next = !target.suspended;
    setError('');
    setBusy(`${target.id}:suspend`);
    replaceRow({ ...target, suspended: next });
    adjustStats({ suspended: next ? 1 : -1 });

    try {
      replaceRow(await adminApi.setSuspended(target.id, next));
    } catch (caught) {
      replaceRow({ ...target, suspended: !next });
      adjustStats({ suspended: next ? -1 : 1 });
      setError(caught instanceof ApiError ? caught.message : t('admin.saveError'));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  async function removeAccount(target: SessionUser) {
    if (busy) return;
    setError('');
    setBusy(`${target.id}:delete`);

    try {
      await adminApi.remove(target.id);
      setRows((current) => current.filter((row) => row.id !== target.id));
      adjustStats({
        total: -1,
        suspended: target.suspended ? -1 : 0,
        buyers: target.role === 'buyer' ? -1 : 0,
        sellers: target.role === 'seller' ? -1 : 0,
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('admin.deleteError'));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const statCards: { key: string; value: number; label: string }[] = [
    { key: 'total', value: stats?.total ?? rows.length, label: t('admin.statTotal') },
    { key: 'buy', value: stats?.buyers ?? 0, label: t('admin.statBuyers') },
    { key: 'sell', value: stats?.sellers ?? 0, label: t('admin.statSellers') },
    { key: 'suspended', value: stats?.suspended ?? 0, label: t('admin.statSuspended') },
  ];

  return (
    <div className="page admin">
      <header className="pagehead admin__head">
        <p className="eyebrow">{t('admin.eyebrow')}</p>
        <h1>{t('admin.title')}</h1>
        <p className="pagehead__lede">{t('admin.lede')}</p>
        <p className="admin__meta">
          <Link to="/admin/credentials">{t('cred.link')}</Link>
        </p>
      </header>

      <ul className="adm__stats">
        {statCards.map((card) => (
          <li key={card.key} className="adm__stat">
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </li>
        ))}
      </ul>

      <section className="adm__panel" aria-label={t('admin.usersHeading')}>
        <div className="adm__panel-head">
          <h2>{t('admin.usersHeading')}</h2>
          <label className="field adm__search">
            <span>{t('admin.search')}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('admin.searchPlaceholder')}
              type="search"
            />
          </label>
        </div>

        {error && (
          <p className="formerror" role="alert">
            {error}
          </p>
        )}

        <p className="adm__count" aria-live="polite">
          {loading ? t('admin.loading') : tp('admin.count', rows.length)}
        </p>

        <ul className="adm__list">
          {rows.map((row) => {
            const isSelf = row.id === admin.id;
            const isAdmin = row.role === 'admin';
            const locked = isSelf || isAdmin;
            const suspending = busy === `${row.id}:suspend`;
            const deleting = busy === `${row.id}:delete`;
            const isConfirming = confirming === row.id;

            return (
              <li
                key={row.id}
                className={`adm__row ${isSelf ? 'is-self' : ''} ${row.suspended ? 'is-suspended' : ''}`}
              >
                <div className="adm__who">
                  <strong>
                    {row.name}
                    {isSelf && <span className="adm__you"> · {t('admin.you')}</span>}
                  </strong>
                  <span className="adm__email">{row.email}</span>
                  <span className="adm__meta">
                    {t('admin.joined', { date: formatJoined(row.createdAt, locale) })}
                  </span>
                </div>

                <div className="adm__badges">
                  <span className={`adm__role adm__role--${row.role}`}>
                    {t(`admin.role.${row.role}`)}
                  </span>
                  {row.suspended && (
                    <span className="adm__role adm__role--suspended">{t('admin.suspended')}</span>
                  )}
                </div>

                {isConfirming ? (
                  <div className="adm__confirm" role="group" aria-label={t('admin.deleteConfirm')}>
                    <span className="adm__confirm-text">{t('admin.deleteConfirm')}</span>
                    <button
                      type="button"
                      className="adm__action adm__action--danger"
                      disabled={deleting}
                      onClick={() => void removeAccount(row)}
                    >
                      {deleting ? t('admin.deleting') : t('admin.deleteYes')}
                    </button>
                    <button
                      type="button"
                      className="adm__action"
                      disabled={deleting}
                      onClick={() => setConfirming(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="adm__actions">
                    <button
                      type="button"
                      className={`adm__action ${row.suspended ? 'adm__action--on' : ''}`}
                      disabled={locked || Boolean(busy)}
                      title={locked ? t('admin.locked') : undefined}
                      onClick={() => void toggleSuspended(row)}
                    >
                      {suspending
                        ? t('admin.saving')
                        : row.suspended
                          ? t('admin.reactivate')
                          : t('admin.suspend')}
                    </button>
                    <button
                      type="button"
                      className="adm__action adm__action--danger"
                      disabled={locked || Boolean(busy)}
                      title={locked ? t('admin.locked') : undefined}
                      onClick={() => setConfirming(row.id)}
                    >
                      {t('admin.delete')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!loading && rows.length === 0 && (
          <p className="adm__empty">{t('admin.empty')}</p>
        )}

        <p className="adm__note">{t('admin.note')}</p>
      </section>

      <PhotoReview />
    </div>
  );
}

export function AdminPage() {
  const { user, ready } = useAuth();
  const { t } = useI18n();

  if (!ready) {
    return <p className="page page--narrow admin__loading">{t('admin.loading')}</p>;
  }
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (user.role !== 'admin') return <Forbidden />;
  // The starter password is public, so the dashboard stays closed until the
  // admin has chosen its own credentials.
  if (user.mustSetPassword) return <Navigate to="/admin/credentials" replace />;

  return <Dashboard admin={user} />;
}
