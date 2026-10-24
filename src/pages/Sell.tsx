import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { formatPrice } from '../lib/format';
import { shrinkImage } from '../lib/image';
import { PinIcon } from '../components/icons';
import { ApiError, cityApi, listingApi, PHOTO_SLOTS, type Listing } from '../lib/api';

const kinds = ['House', 'Apartment', 'Loft', 'Villa', 'Restaurant'] as const;
const SLOTS = Array.from({ length: PHOTO_SLOTS }, (_, index) => index + 1);

type Draft = { file: File; url: string };

/**
 * Five photo slots. Empty slots open a file picker; a filled slot can be
 * replaced by clicking it and removed with the × in the corner. The parent
 * decides what the bytes mean: a pending file before publishing, an upload
 * afterwards.
 */
export function PhotoSlotGrid({
  photos,
  onPick,
  onClear,
  busy = null,
  error = '',
}: {
  photos: (string | null)[];
  onPick: (slot: number, file: File) => void;
  onClear?: (slot: number) => void;
  busy?: number | null;
  error?: string;
}) {
  const { t } = useI18n();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  return (
    <div className="photoslots">
      <div className="photoslots__grid">
        {photos.map((src, index) => {
          const slot = index + 1;
          return (
            <div key={slot} className={`photoslot ${src ? 'is-filled' : ''}`}>
              {src ? (
                <button
                  type="button"
                  className="photoslot__swap"
                  aria-label={t('sell.replacePhoto')}
                  title={t('sell.replacePhoto')}
                  disabled={busy !== null}
                  onClick={() => inputs.current[index]?.click()}
                >
                  <img
                    className="photoslot__img"
                    src={src}
                    alt={t('sell.photoSlot', { n: slot })}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  className="photoslot__add"
                  disabled={busy !== null}
                  onClick={() => inputs.current[index]?.click()}
                >
                  <span className="photoslot__plus" aria-hidden="true">
                    +
                  </span>
                  <span>{t('sell.addPhoto')}</span>
                </button>
              )}

              {onClear && src && (
                <button
                  type="button"
                  className="photoslot__remove"
                  aria-label={t('sell.removePhoto')}
                  title={t('sell.removePhoto')}
                  disabled={busy !== null}
                  onClick={() => onClear(slot)}
                >
                  ×
                </button>
              )}

              {busy === slot && <span className="photoslot__busy">{t('sell.photoBusy')}</span>}

              <input
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Clear the value so picking the same file again still fires.
                  event.target.value = '';
                  if (file) onPick(slot, file);
                }}
              />
            </div>
          );
        })}
      </div>
      {error && (
        <p className="formerror" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Photo slots for a listing that is already published. */
function ListingPhotos({
  listing,
  onUpdate,
}: {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function onPick(slot: number, file: File) {
    if (!file.type.startsWith('image/')) {
      setError(t('sell.errorPhotoType'));
      return;
    }
    setError('');
    setBusy(slot);
    try {
      const blob = await shrinkImage(file, 1600);
      onUpdate(await listingApi.uploadPhoto(listing.id, slot, blob));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('sell.errorPhotoUpload'));
    } finally {
      setBusy(null);
    }
  }

  async function onClear(slot: number) {
    setError('');
    setBusy(slot);
    try {
      onUpdate(await listingApi.removePhoto(listing.id, slot));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('sell.errorPhotoUpload'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PhotoSlotGrid
      photos={SLOTS.map((slot) => {
        const slug = listing.photos.find((photo) => photo.slot === slot)?.slug;
        return slug ? `api/media/${slug}` : null;
      })}
      onPick={(slot, file) => void onPick(slot, file)}
      onClear={(slot) => void onClear(slot)}
      busy={busy}
      error={error}
    />
  );
}

export function Sell() {
  const { user, ready } = useAuth();
  const { t } = useI18n();

  const [cities, setCities] = useState<string[]>([]);
  const [mine, setMine] = useState<Listing[] | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('House');
  const [city, setCity] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [drafts, setDrafts] = useState<(Draft | null)[]>(Array(PHOTO_SLOTS).fill(null));
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [created, setCreated] = useState<Listing | null>(null);
  const draftUrls = useRef(new Set<string>());

  // Object URLs for the previews outlive a render, so release them on unmount.
  useEffect(
    () => () => {
      draftUrls.current.forEach((url) => URL.revokeObjectURL(url));
      draftUrls.current.clear();
    },
    [],
  );

  const loadCities = () =>
    cityApi
      .list()
      .then((rows) => setCities(rows.map((row) => row.name)))
      .catch(() => undefined);

  useEffect(() => {
    if (!user) return;
    void loadCities();
    listingApi
      .mine()
      .then(setMine)
      .catch(() => setMine([]));
  }, [user]);

  if (!ready) {
    return <p className="page page--narrow admin__loading">{t('admin.loading')}</p>;
  }
  if (!user) return <Navigate to="/login?next=/sell" replace />;
  // Buyers have no studio: an old link (or a demoted account) goes to the
  // listings they can actually visit instead of a seller-only dead end.
  if (!user.canSell) return <Navigate to="/homes" replace />;

  function pickDraft(slot: number, file: File) {
    if (!file.type.startsWith('image/')) {
      setPhotoError(t('sell.errorPhotoType'));
      return;
    }
    setPhotoError('');
    const url = URL.createObjectURL(file);
    draftUrls.current.add(url);
    setDrafts((current) => {
      const previous = current[slot - 1];
      if (previous) {
        URL.revokeObjectURL(previous.url);
        draftUrls.current.delete(previous.url);
      }
      const next = [...current];
      next[slot - 1] = { file, url };
      return next;
    });
  }

  function clearDraft(slot: number) {
    setDrafts((current) => {
      const previous = current[slot - 1];
      if (previous) {
        URL.revokeObjectURL(previous.url);
        draftUrls.current.delete(previous.url);
      }
      const next = [...current];
      next[slot - 1] = null;
      return next;
    });
  }

  function resetDrafts() {
    draftUrls.current.forEach((url) => URL.revokeObjectURL(url));
    draftUrls.current.clear();
    setDrafts(Array(PHOTO_SLOTS).fill(null));
  }

  function replaceListing(next: Listing) {
    setMine((current) =>
      current ? current.map((row) => (row.id === next.id ? next : row)) : current,
    );
    setCreated((current) => (current?.id === next.id ? next : current));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const amount = Number.parseInt(price, 10);
    if (title.trim().length < 4) {
      setError(t('sell.errorTitle'));
      return;
    }
    if (city.trim().length < 2) {
      setError(t('sell.errorCity'));
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError(t('sell.errorPrice'));
      return;
    }

    setError('');
    setPhotoError('');
    setPending(true);

    let listing: Listing | null = null;
    try {
      listing = await listingApi.create({
        title: title.trim(),
        kind,
        city: city.trim(),
        price: amount,
        description: description.trim(),
      });

      let latest = listing;
      setCreated(latest);
      setMine((current) => (current ? [latest, ...current] : [latest]));
      setTitle('');
      setPrice('');
      setDescription('');
      // The new town may not have been selectable before this listing.
      void loadCities();

      // Publish first, then attach the chosen photos to their slots. A failed
      // photo leaves the listing live and reports which slot to retry.
      for (const slot of SLOTS) {
        const draft = drafts[slot - 1];
        if (!draft) continue;
        setUploading(slot);
        try {
          const blob = await shrinkImage(draft.file, 1600);
          latest = await listingApi.uploadPhoto(latest.id, slot, blob);
        } catch {
          setPhotoError(t('sell.errorPhotoUpload'));
        }
      }

      replaceListing(latest);
      setCreated(latest);
      resetDrafts();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('sell.errorGeneric'));
    } finally {
      setUploading(null);
      setPending(false);
    }
  }

  return (
    <div className="page sell">
      {/* The page is deliberately just form and listings; keep a heading for
          screen readers without bringing the studio hero back. */}
      <h1 className="visually-hidden">{t('sell.title')}</h1>

      <div className="sell__grid">
        <form className="sell__form" onSubmit={onSubmit}>
          <div className="sell__head">
            <h2>{t('sell.formTitle')}</h2>
            <p>{t('sell.formSub')}</p>
          </div>

          <label className="field">
            <span>{t('sell.titleField')}</span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setCreated(null);
              }}
              placeholder={t('sell.titlePlaceholder')}
              minLength={4}
              maxLength={120}
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>{t('sell.kind')}</span>
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                {kinds.map((option) => (
                  <option key={option} value={option}>
                    {t(`sell.kind.${option}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('sell.price')}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="350000"
                required
              />
            </label>
          </div>

          <label className="field">
            <span>{t('sell.city')}</span>
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              list="sell-cities"
              placeholder={t('sell.cityPlaceholder')}
              maxLength={80}
              required
            />
            <datalist id="sell-cities">
              {cities.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <p className="sell__hint">{t('sell.cityHint')}</p>

          <label className="field">
            <span>{t('sell.description')}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={t('sell.descriptionPlaceholder')}
            />
          </label>

          <div className="sell__photos">
            <p className="sell__photos-title">{t('sell.photosTitle')}</p>
            <p className="sell__hint">{t('sell.photosSub')}</p>
            <PhotoSlotGrid
              photos={drafts.map((draft) => draft?.url ?? null)}
              onPick={pickDraft}
              onClear={clearDraft}
              busy={uploading}
              error={photoError}
            />
          </div>

          {error && (
            <p className="formerror" role="alert">
              {error}
            </p>
          )}

          <button className="button" type="submit" disabled={pending}>
            {uploading
              ? t('sell.uploadingPhoto', { n: uploading })
              : pending
                ? t('sell.submitting')
                : t('sell.submit')}
          </button>

          {created && (
            <div className="sell__created" role="status">
              <p>{t('sell.created', { title: created.title, city: created.city })}</p>
              <div className="empty__actions">
                <Link className="button button--ghost button--small" to={`/listings/${created.id}`}>
                  {t('common.viewListing')}
                </Link>
                <Link className="button button--ghost button--small" to="/homes">
                  {t('sell.browse')}
                </Link>
              </div>
            </div>
          )}
        </form>

        <aside className="sell__mine" aria-label={t('sell.myTitle')}>
          <h2>{t('sell.myTitle')}</h2>
          <p className="sell__sub">{t('sell.mySub')}</p>

          {mine === null ? (
            <p className="book__hint">{t('admin.loading')}</p>
          ) : mine.length === 0 ? (
            <p className="book__hint">{t('sell.myEmpty')}</p>
          ) : (
            <ul className="sell__list">
              {mine.map((listing) => (
                <li key={listing.id} className="sell__item">
                  <div className="sell__item-head">
                    <Link className="sell__item-title" to={`/listings/${listing.id}`}>
                      {listing.title}
                    </Link>
                    {listing.price !== undefined && <span className="sell__price">{formatPrice(listing.price)}</span>}
                  </div>
                  <span className="sell__place">
                    <PinIcon width={13} height={13} /> {listing.city} · {listing.kind}
                  </span>
                  <ListingPhotos listing={listing} onUpdate={replaceListing} />
                </li>
              ))}
            </ul>
          )}

          <div className="sell__cities">
            <p className="sell__cities-title">{t('sell.cityList')}</p>
            <ul className="chips">
              {cities.map((option) => (
                <li key={option}>{option}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
