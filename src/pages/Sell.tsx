import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { formatPrice } from '../lib/format';
import { isPhotoTooLarge, LISTING_PHOTO, shrinkImage } from '../lib/image';
import { PinIcon } from '../components/icons';
import {
  ApiError,
  cityApi,
  listingApi,
  PHOTO_SLOTS,
  sellerViewingApi,
  type Listing,
  type ViewingRequest,
} from '../lib/api';
import { formatDay } from '../lib/format';

const coverSlug = (listing: Listing) =>
  [...listing.photos].sort((a, b) => a.slot - b.slot)[0]?.slug;

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
      const blob = await shrinkImage(file, LISTING_PHOTO);
      onUpdate(await listingApi.uploadPhoto(listing.id, slot, blob));
    } catch (caught) {
      setError(
        isPhotoTooLarge(caught)
          ? t('photo.tooLarge')
          : caught instanceof ApiError
            ? caught.message
            : t('sell.errorPhotoUpload'),
      );
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

/** The form card: adds a listing, or edits one the seller already owns. */
function ListingForm({
  listing,
  cities,
  onSaved,
  onPhotos,
  onClose,
}: {
  listing: Listing | null;
  cities: string[];
  onSaved: (listing: Listing, isNew: boolean) => void;
  onPhotos: (listing: Listing) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(listing?.title ?? '');
  const [kind, setKind] = useState<string>(listing?.kind ?? 'House');
  const [city, setCity] = useState(listing?.city ?? '');
  const [price, setPrice] = useState(listing?.price !== undefined ? String(listing.price) : '');
  const [description, setDescription] = useState(listing?.description ?? '');
  const [drafts, setDrafts] = useState<(Draft | null)[]>(Array(PHOTO_SLOTS).fill(null));
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const draftUrls = useRef(new Set<string>());

  // Object URLs for the previews outlive a render, so release them on unmount.
  useEffect(
    () => () => {
      draftUrls.current.forEach((url) => URL.revokeObjectURL(url));
      draftUrls.current.clear();
    },
    [],
  );

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

    const input = {
      title: title.trim(),
      kind,
      city: city.trim(),
      price: amount,
      description: description.trim(),
    };
    try {
      let latest = listing
        ? await listingApi.update(listing.id, input)
        : await listingApi.create(input);

      // Publish first, then attach the chosen photos to their slots. A failed
      // photo leaves the listing live and reports which slot to retry.
      let failed = false;
      for (const slot of SLOTS) {
        const draft = drafts[slot - 1];
        if (!draft) continue;
        setUploading(slot);
        try {
          const blob = await shrinkImage(draft.file, LISTING_PHOTO);
          latest = await listingApi.uploadPhoto(latest.id, slot, blob);
        } catch {
          failed = true;
        }
      }
      onSaved(latest, !listing);
      if (failed) {
        // Stay on the listing in edit mode so the failed slot can be retried.
        return;
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('sell.errorGeneric'));
    } finally {
      setUploading(null);
      setPending(false);
    }
  }

  return (
    <form className="sell__form" onSubmit={onSubmit} aria-label={listing ? t('sell.editTitle') : t('sell.formTitle')}>
      <div className="sell__head">
        <h2>{listing ? t('sell.editTitle') : t('sell.formTitle')}</h2>
        <p>{t('sell.formSub')}</p>
      </div>

      <label className="field">
        <span>{t('sell.titleField')}</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
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
        {listing && <ListingPhotos listing={listing} onUpdate={onPhotos} />}
        {(!listing || drafts.some(Boolean)) && (
          <PhotoSlotGrid
            photos={drafts.map((draft) => draft?.url ?? null)}
            onPick={pickDraft}
            onClear={clearDraft}
            busy={uploading}
            error={photoError}
          />
        )}
      </div>

      {error && (
        <p className="formerror" role="alert">
          {error}
        </p>
      )}

      <div className="sell__actions">
        <button className="button" type="submit" disabled={pending}>
          {uploading
            ? t('sell.uploadingPhoto', { n: uploading })
            : pending
              ? t('sell.submitting')
              : listing
                ? t('sell.save')
                : t('sell.submit')}
        </button>
        <button className="button button--ghost" type="button" onClick={onClose} disabled={pending}>
          {t('sell.cancel')}
        </button>
      </div>
    </form>
  );
}

/** One row of "My listings": cover, title, price, photo count, edit and delete. */
export function ListingRow({
  listing,
  requestCount = 0,
  onEdit,
  onDelete,
}: {
  listing: Listing;
  requestCount?: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, tp } = useI18n();
  const cover = coverSlug(listing);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="sell__item">
      <div className="sell__cover">
        {cover ? (
          <img src={`api/media/${cover}`} alt="" />
        ) : (
          <span>{t('sell.noCover')}</span>
        )}
      </div>
      <div className="sell__item-main">
        <div className="sell__item-head">
          <Link className="sell__item-title" to={`/listings/${listing.id}`}>
            {listing.title}
          </Link>
          {listing.price !== undefined && (
            <span className="sell__price">{formatPrice(listing.price)}</span>
          )}
        </div>
        <span className="sell__place">
          <PinIcon width={13} height={13} /> {listing.city} · {listing.kind}
        </span>
        <span className="sell__count">
          {t('sell.photoCount', { n: listing.photos.length, max: PHOTO_SLOTS })} ·{' '}
          {tp('sell.requestCount', requestCount)}
        </span>
        <div className="sell__item-actions">
          {confirming ? (
            <>
              <span className="sell__confirm">{t('sell.deleteConfirm')}</span>
              <button className="button button--small" type="button" onClick={onDelete}>
                {t('sell.deleteYes')}
              </button>
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => setConfirming(false)}
              >
                {t('sell.cancel')}
              </button>
            </>
          ) : (
            <>
              <button className="button button--ghost button--small" type="button" onClick={onEdit}>
                {t('sell.edit')}
              </button>
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => setConfirming(true)}
              >
                {t('sell.delete')}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** One viewing request with the visitor's details and the seller's answer. */
export function RequestCard({
  request,
  onAnswer,
}: {
  request: ViewingRequest;
  onAnswer: (status: 'Confirmed' | 'Cancelled') => void;
}) {
  const { t, locale } = useI18n();
  return (
    <li className="sell__request">
      <div className="sell__request-head">
        <strong>{request.listingTitle}</strong>
        <span className={`sell__status sell__status--${request.status}`}>
          {t(`status.${request.status}`)}
        </span>
      </div>
      <span className="sell__place">
        {formatDay(request.date, locale)} · {request.time}
      </span>
      <span className="sell__request-who">
        {request.name} · <a href={`mailto:${request.email}`}>{request.email}</a>
      </span>
      {request.description && <p className="sell__request-note">{request.description}</p>}
      {request.status !== 'Cancelled' && (
        <div className="sell__item-actions">
          {request.status === 'Requested' && (
            <button className="button button--small" type="button" onClick={() => onAnswer('Confirmed')}>
              {t('sell.confirm')}
            </button>
          )}
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={() => onAnswer('Cancelled')}
          >
            {t('sell.decline')}
          </button>
        </div>
      )}
    </li>
  );
}

/** What a signed-in buyer sees at /sell instead of the dashboard. */
export function SellerOnly() {
  const { t } = useI18n();
  return (
    <div className="page page--narrow sell">
      <h1>{t('sell.buyerTitle')}</h1>
      <p className="sell__sub">{t('sell.buyerBody')}</p>
      <div className="empty__actions">
        <Link className="button" to="/signup">
          {t('sell.buyerSignup')}
        </Link>
        <Link className="button button--ghost" to="/homes">
          {t('sell.browse')}
        </Link>
      </div>
    </div>
  );
}

export function Sell() {
  const { user, ready } = useAuth();
  const { t } = useI18n();

  const [cities, setCities] = useState<string[]>([]);
  const [mine, setMine] = useState<Listing[] | null>(null);
  // null = closed, 'new' = add form, otherwise the id of the listing being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Listing | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [requests, setRequests] = useState<ViewingRequest[]>([]);
  const [requestError, setRequestError] = useState('');

  const loadCities = () =>
    cityApi
      .list()
      .then((rows) => setCities(rows.map((row) => row.name)))
      .catch(() => undefined);

  useEffect(() => {
    if (!user?.canSell) return;
    void loadCities();
    listingApi
      .mine()
      .then(setMine)
      .catch(() => setMine([]));
    sellerViewingApi
      .list()
      .then(setRequests)
      .catch(() => setRequests([]));
  }, [user]);

  if (!ready) {
    return <p className="page page--narrow admin__loading">{t('admin.loading')}</p>;
  }
  if (!user) return <Navigate to="/login?next=/sell" replace />;
  if (!user.canSell) return <SellerOnly />;

  function replaceListing(next: Listing) {
    setMine((current) =>
      current ? current.map((row) => (row.id === next.id ? next : row)) : current,
    );
  }

  function onSaved(next: Listing, isNew: boolean) {
    if (isNew) setMine((current) => (current ? [next, ...current] : [next]));
    else replaceListing(next);
    setNotice(isNew ? next : null);
    void loadCities();
  }

  async function answer(request: ViewingRequest, status: 'Confirmed' | 'Cancelled') {
    setRequestError('');
    try {
      const updated = await sellerViewingApi.answer(request.id, status);
      setRequests((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      setRequestError(t('sell.errorAnswer'));
    }
  }

  async function onDelete(listing: Listing) {
    setDeleteError('');
    try {
      await listingApi.remove(listing.id);
      setMine((current) => (current ? current.filter((row) => row.id !== listing.id) : current));
      if (editing === listing.id) setEditing(null);
      setNotice((current) => (current?.id === listing.id ? null : current));
    } catch (caught) {
      setDeleteError(caught instanceof ApiError ? caught.message : t('sell.errorDelete'));
    }
  }

  const editedListing = editing && editing !== 'new' ? (mine?.find((row) => row.id === editing) ?? null) : null;

  return (
    <div className="page sell">
      <div className="sell__bar">
        <h1>{t('sell.dashboardTitle')}</h1>
        {editing === null && (
          <button
            className="button"
            type="button"
            onClick={() => {
              setNotice(null);
              setEditing('new');
            }}
          >
            {t('sell.add')}
          </button>
        )}
      </div>

      {notice && (
        <div className="sell__created" role="status">
          <p>{t('sell.created', { title: notice.title, city: notice.city })}</p>
          <div className="empty__actions">
            <Link className="button button--ghost button--small" to={`/listings/${notice.id}`}>
              {t('common.viewListing')}
            </Link>
            <Link className="button button--ghost button--small" to="/homes">
              {t('sell.browse')}
            </Link>
          </div>
        </div>
      )}

      <div className="sell__grid">
        {editing !== null && (
          <ListingForm
            key={editing}
            listing={editedListing}
            cities={cities}
            onSaved={onSaved}
            onPhotos={replaceListing}
            onClose={() => setEditing(null)}
          />
        )}

        <section className="sell__mine" aria-label={t('sell.myTitle')}>
          <h2>{t('sell.myTitle')}</h2>
          <p className="sell__sub">{t('sell.mySub')}</p>

          {deleteError && (
            <p className="formerror" role="alert">
              {deleteError}
            </p>
          )}

          {mine === null ? (
            <p className="book__hint">{t('admin.loading')}</p>
          ) : mine.length === 0 ? (
            <p className="book__hint">{t('sell.myEmpty')}</p>
          ) : (
            <ul className="sell__list">
              {mine.map((listing) => (
                <ListingRow
                  key={listing.id}
                  listing={listing}
                  requestCount={
                    requests.filter((row) => row.listingId === `listing:${listing.id}`).length
                  }
                  onEdit={() => {
                    setNotice(null);
                    setEditing(listing.id);
                  }}
                  onDelete={() => void onDelete(listing)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="sell__mine" aria-label={t('sell.requestsTitle')}>
          <h2>{t('sell.requestsTitle')}</h2>
          {requestError && (
            <p className="formerror" role="alert">
              {requestError}
            </p>
          )}
          {requests.length === 0 ? (
            <p className="book__hint">{t('sell.requestsEmpty')}</p>
          ) : (
            <ul className="sell__list sell__requests">
              {requests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onAnswer={(status) => void answer(request, status)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
