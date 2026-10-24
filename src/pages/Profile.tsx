import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { Avatar } from '../components/Avatar';
import { ApiError, profileApi, type Profile as ProfileRow } from '../lib/api';
import { shrinkImage } from '../lib/image';

export function Profile() {
  const { user, ready } = useAuth();
  const { t } = useI18n();

  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [bio, setBio] = useState('');
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setDisplayName((current) => current || user.name);
    profileApi
      .me()
      .then((row) => {
        if (!alive || !row) return;
        setProfile(row);
        setDisplayName(row.displayName);
        setPhone(row.phone ?? '');
        setCompany(row.company ?? '');
        setLookingFor(row.lookingFor ?? '');
        setBio(row.bio ?? '');
      })
      .catch(() => {
        if (alive) setError(t('profile.loadError'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user, t]);

  if (!ready) {
    return <p className="page page--narrow admin__loading">{t('admin.loading')}</p>;
  }
  if (!user) return <Navigate to="/login?next=/profile" replace />;
  // Admins have no public profile: send them to the dashboard instead of
  // leaving a dead-end notice where the page used to be.
  if (user.role === 'admin') return <Navigate to="/admin" replace />;

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaved(false);
    if (displayName.trim().length < 2) {
      setError(t('profile.errorName'));
      return;
    }
    setSaving(true);
    try {
      const next = await profileApi.save({
        displayName: displayName.trim(),
        phone: phone.trim(),
        company: company.trim(),
        lookingFor: lookingFor.trim(),
        bio: bio.trim(),
      });
      setProfile(next);
      setDisplayName(next.displayName);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('profile.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoError('');
    if (!file.type.startsWith('image/')) {
      setPhotoError(t('profile.errorPhotoType'));
      return;
    }
    setUploading(true);
    try {
      const blob = await shrinkImage(file, 900);
      const next = await profileApi.uploadPhoto(blob);
      setProfile(next);
    } catch (caught) {
      setPhotoError(
        caught instanceof ApiError ? caught.message : t('profile.errorPhotoUpload'),
      );
    } finally {
      setUploading(false);
    }
  }

  const status = profile?.photoStatus ?? 'none';
  const statusNote =
    status === 'pending'
      ? t('profile.photoPendingHelp')
      : status === 'approved'
        ? t('profile.photoApprovedHelp')
        : status === 'rejected'
          ? t('profile.photoRejectedHelp')
          : t('profile.photoNoneHelp');

  return (
    <div className="page profile">
      {/* The banner was removed at the client's request; the heading stays for
          screen readers and the two cards start the page. */}
      <h1 className="visually-hidden">{t('profile.title')}</h1>

      <div className="profile__grid">
        <form className="profile__form" onSubmit={onSave}>
          <div className="profile__head">
            <h2>{t('profile.detailsTitle')}</h2>
            <p>
              {t(
                user.role === 'seller' ? 'profile.detailsSubSeller' : 'profile.detailsSubBuyer',
              )}
            </p>
          </div>

          <div className="field-row">
            <label className="field">
              <span>{t('profile.name')}</span>
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setSaved(false);
                }}
                minLength={2}
                required
              />
            </label>
            <label className="field">
              <span>{t('profile.phone')}</span>
              <input
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setSaved(false);
                }}
                autoComplete="tel"
                placeholder="+34 600 000 000"
              />
            </label>
          </div>

          {user.role === 'seller' ? (
            <label className="field">
              <span>{t('profile.company')}</span>
              <input
                value={company}
                onChange={(event) => {
                  setCompany(event.target.value);
                  setSaved(false);
                }}
                placeholder={t('profile.companyPlaceholder')}
              />
            </label>
          ) : (
            <label className="field">
              <span>{t('profile.lookingFor')}</span>
              <input
                value={lookingFor}
                onChange={(event) => {
                  setLookingFor(event.target.value);
                  setSaved(false);
                }}
                placeholder={t('profile.lookingForPlaceholder')}
              />
            </label>
          )}

          <label className="field">
            <span>{t('profile.bio')}</span>
            <textarea
              value={bio}
              onChange={(event) => {
                setBio(event.target.value);
                setSaved(false);
              }}
              rows={4}
              maxLength={600}
              placeholder={t('profile.bioPlaceholder')}
            />
          </label>

          {error && (
            <p className="formerror" role="alert">
              {error}
            </p>
          )}

          <div className="profile__actions">
            <button className="button" type="submit" disabled={saving || loading}>
              {saving ? t('profile.saving') : t('profile.save')}
            </button>
            {saved && (
              <span className="profile__saved" role="status">
                {t('profile.saved')}
              </span>
            )}
          </div>
        </form>

        <aside className="profile__photo" aria-label={t('profile.photoTitle')}>
          <h2>{t('profile.photoTitle')}</h2>
          <div className="profile__avatar">
            <Avatar
              key={profile?.photoSlug ?? 'initials'}
              name={displayName || user.name}
              photoSlug={profile?.photoSlug}
              size={124}
            />
            <span className={`pill pill--${status}`}>{t(`photo.${status}`)}</span>
          </div>
          <p className="profile__status">{statusNote}</p>

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            onChange={(event) => void onPhoto(event)}
          />
          <button
            className="button button--ghost button--block"
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading
              ? t('profile.uploading')
              : profile?.photoSlug
                ? t('profile.replacePhoto')
                : t('profile.choosePhoto')}
          </button>
          {photoError && (
            <p className="formerror" role="alert">
              {photoError}
            </p>
          )}
          <p className="profile__fine">{t('profile.photoFine')}</p>
        </aside>
      </div>
    </div>
  );
}
