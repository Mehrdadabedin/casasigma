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
  isPhotoLimit,
  listingApi,
  PHOTO_SLOTS,
  type PhotoUsage,
  sellerViewingApi,
  type Listing,
  type ViewingRequest,
} from '../lib/api';
import { formatDay } from '../lib/format';

const coverSlug = (listing: Listing) =>
  [...listing.photos].sort((a, b) => a.slot - b.slot)[0]?.slug;

const kinds = ['House', 'Apartment', 'Loft', 'Villa', 'Restaurant'] as const;

type Draft = { slot: number; file: File; url: string };

/**
 * The slot a new photo takes: after the highest one in use, so removing the
 * cover never promotes the next new photo to cover. Past slot 20 it takes the
 * lowest free slot. `room` is how many photos the seller may still add; at 0
 * (or with no free slot) there is no next slot.
 */
export function nextPhotoSlot(taken: number[], room: number): number | null {
  if (room <= 0) return null;
  const last = Math.max(0, ...taken) + 1;
  if (last <= PHOTO_SLOTS) return last;
  for (let slot = 1; slot <= PHOTO_SLOTS; slot += 1) {
    if (!taken.includes(slot)) return slot;
  }
  return null;
}

/**
 * The photos so far, in slot order, and one "Add photo" box for the next one.
 * At the limit (`nextSlot` is null) the box gives way to a short message. A
 * filled photo can be replaced by clicking it and removed with the × in the
 * corner. The parent decides what the bytes mean: a pending file before
 * publishing, an upload afterwards.
 */
export function PhotoSlotGrid({
  photos,
  nextSlot,
  onPick,
  onClear,
  busy = null,
  error = '',
}: {
  photos: { slot: number; src: string }[];
  nextSlot: number | null;
  onPick: (slot: number, file: File) => void;
  onClear?: (slot: number) => void;
  busy?: number | null;
  error?: string;
}) {
  const { t } = useI18n();
  const inputs = useRef(new Map<number, HTMLInputElement | null>());

  const fileInput = (slot: number) => (
    <input
      ref={(node) => {
        inputs.current.set(slot, node);
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
  );

  return (
    <div className="photoslots">
      <div className="photoslots__grid">
        {photos.map(({ slot, src }) => (
          <div key={slot} className="photoslot is-filled">
            <button
              type="button"
              className="photoslot__swap"
              aria-label={t('sell.replacePhoto')}
              title={t('sell.replacePhoto')}
              disabled={busy !== null}
              onClick={() => inputs.current.get(slot)?.click()}
            >
              <img className="photoslot__img" src={src} alt={t('sell.photoSlot', { n: slot })} />
            </button>

            {onClear && (
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
            {fileInput(slot)}
          </div>
        ))}

        {nextSlot !== null && (
          <div className="photoslot" data-slot={nextSlot}>
            <button
              type="button"
              className="photoslot__add"
              disabled={busy !== null}
              onClick={() => inputs.current.get(nextSlot)?.click()}
            >
              <span className="photoslot__plus" aria-hidden="true">
                +
              </span>
              <span>{t('sell.addPhoto')}</span>
            </button>
            {busy === nextSlot && <span className="photoslot__busy">{t('sell.photoBusy')}</span>}
            {fileInput(nextSlot)}
          </div>
        )}
      </div>
      {nextSlot === null && <p className="sell__hint">{t('sell.photoLimit')}</p>}
      {error && (
        <p className="formerror" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const photoErrorText = (caught: unknown, t: (key: string) => string) =>
  isPhotoTooLarge(caught)
    ? t('photo.tooLarge')
    : isPhotoLimit(caught)
      ? t('sell.photoLimit')
      : caught instanceof ApiError
        ? caught.message
        : t('sell.errorPhotoUpload');

/** Photos of a listing that is already published; each change is saved at once. */
function ListingPhotos({
  listing,
  usage,
  initialError = '',
  onUpdate,
}: {
  listing: Listing;
  usage: PhotoUsage;
  initialError?: string;
  onUpdate: (listing: Listing, usage: PhotoUsage) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState(initialError);

  async function onPick(slot: number, file: File) {
    if (!file.type.startsWith('image/')) {
      setError(t('sell.errorPhotoType'));
      return;
    }
    setError('');
    setBusy(slot);
    try {
      const blob = await shrinkImage(file, LISTING_PHOTO);
      const result = await listingApi.uploadPhoto(listing.id, slot, blob);
      onUpdate(result.listing, result.photoUsage);
    } catch (caught) {
      setError(photoErrorText(caught, t));
    } finally {
      setBusy(null);
    }
  }

  async function onClear(slot: number) {
    setError('');
    setBusy(slot);
    try {
      const result = await listingApi.removePhoto(listing.id, slot);
      onUpdate(result.listing, result.photoUsage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('sell.errorPhotoUpload'));
    } finally {
      setBusy(null);
    }
  }

  const photos = [...listing.photos]
    .sort((a, b) => a.slot - b.slot)
    .map((photo) => ({ slot: photo.slot, src: `api/media/${photo.slug}` }));

  return (
    <PhotoSlotGrid
      photos={photos}
      nextSlot={nextPhotoSlot(
        photos.map((photo) => photo.slot),
        usage.max - usage.used,
      )}
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
  usage,
  startError,
  onSaved,
  onPhotos,
  onClose,
}: {
  listing: Listing | null;
  cities: string[];
  usage: PhotoUsage;
  startError: string;
  onSaved: (listing: Listing, isNew: boolean, usage: PhotoUsage | null, photoError: string) => void;
  onPhotos: (listing: Listing, usage: PhotoUsage) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(listing?.title ?? '');
  const [kind, setKind] = useState<string>(listing?.kind ?? 'House');
  const [city, setCity] = useState(listing?.city ?? '');
  const [price, setPrice] = useState(listing?.price !== undefined ? String(listing.price) : '');
  const [description, setDescription] = useState(listing?.description ?? '');
  // Photos chosen before the listing exists; only a new listing has them.
  const [drafts, setDrafts] = useState<Draft[]>([]);
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
      const previous = current.find((draft) => draft.slot === slot);
      if (previous) {
        URL.revokeObjectURL(previous.url);
        draftUrls.current.delete(previous.url);
      }
      return [...current.filter((draft) => draft.slot !== slot), { slot, file, url }].sort(
        (a, b) => a.slot - b.slot,
      );
    });
  }

  function clearDraft(slot: number) {
    setDrafts((current) => {
      const previous = current.find((draft) => draft.slot === slot);
      if (previous) {
        URL.revokeObjectURL(previous.url);
        draftUrls.current.delete(previous.url);
      }
      return current.filter((draft) => draft.slot !== slot);
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
      // photo leaves the listing live, in edit mode, with the reason shown.
      let latestUsage: PhotoUsage | null = null;
      let failure = '';
      for (const draft of drafts) {
        setUploading(draft.slot);
        try {
          const blob = await shrinkImage(draft.file, LISTING_PHOTO);
          const result = await listingApi.uploadPhoto(latest.id, draft.slot, blob);
          latest = result.listing;
          latestUsage = result.photoUsage;
        } catch (caught) {
          failure = photoErrorText(caught, t);
        }
      }
      onSaved(latest, !listing, latestUsage, failure);
      if (!failure) onClose();
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
        {listing ? (
          <ListingPhotos
            listing={listing}
            usage={usage}
            initialError={startError}
            onUpdate={onPhotos}
          />
        ) : (
          <PhotoSlotGrid
            photos={drafts.map((draft) => ({ slot: draft.slot, src: draft.url }))}
            nextSlot={nextPhotoSlot(
              drafts.map((draft) => draft.slot),
              usage.max - usage.used - drafts.length,
            )}
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
          {tp('listing.photoCount', listing.photos.length)} ·{' '}
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
  const [usage, setUsage] = useState<PhotoUsage>({ used: 0, max: PHOTO_SLOTS });
  // A photo that failed while publishing; shown again once the form reopens in edit mode.
  const [carriedError, setCarriedError] = useState('');
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
      .then((data) => {
        setMine(data.listings);
        setUsage(data.photoUsage);
      })
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

  function onPhotos(next: Listing, nextUsage: PhotoUsage) {
    replaceListing(next);
    setUsage(nextUsage);
  }

  function onSaved(next: Listing, isNew: boolean, nextUsage: PhotoUsage | null, photoError: string) {
    if (isNew) setMine((current) => (current ? [next, ...current] : [next]));
    else replaceListing(next);
    if (nextUsage) setUsage(nextUsage);
    setCarriedError(photoError);
    // Stay on the saved listing in edit mode so the failed photos can be retried.
    if (photoError) setEditing(next.id);
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
      const result = await listingApi.remove(listing.id);
      setUsage(result.photoUsage);
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
              setCarriedError('');
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
            usage={usage}
            startError={carriedError}
            onSaved={onSaved}
            onPhotos={onPhotos}
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
                    setCarriedError('');
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
