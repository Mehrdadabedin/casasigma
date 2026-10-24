import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListingPhoto, Photo } from '../components/Photo';
import { LockedDetail, useLocked } from '../components/Locked';
import { ArrowLeftIcon, PinIcon } from '../components/icons';
import { formatPrice } from '../lib/format';
import { listingApi, type Listing } from '../lib/api';
import { useI18n } from '../state/LanguageProvider';

/**
 * A listing a seller published from the studio, with the photos they uploaded.
 * The demo catalogue has its own `/homes/:id` page; this one reads from
 * Postgres and is linked from "Just listed" and from the seller's own list.
 */
export function ListingDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { t, tp } = useI18n();
  const locked = useLocked();

  const [listing, setListing] = useState<Listing | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [active, setActive] = useState(0);

  useEffect(() => {
    // Nothing is fetched for a guest: the API answers 401 and the page is a
    // sign-in prompt anyway.
    if (locked) return;
    let alive = true;
    setState('loading');
    setActive(0);
    listingApi
      .get(id)
      .then((row) => {
        if (!alive) return;
        setListing(row);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('missing');
      });
    return () => {
      alive = false;
    };
  }, [id, locked]);

  if (locked) {
    return (
      <LockedDetail
        media={<Photo gradient={['#e3d3b6', '#8fa295']} label="" className="photo--hero" />}
        backTo="/homes"
        backLabel={t('house.all')}
        bookTo={`/book?listing=listing:${id}`}
      />
    );
  }

  if (state === 'loading') {
    return <p className="page page--narrow admin__loading">{t('listing.loading')}</p>;
  }

  if (!listing) {
    return (
      <div className="page page--narrow">
        <p className="eyebrow">{t('listing.eyebrow')}</p>
        <h1>{t('listing.notFound')}</h1>
        <p className="pagehead__lede">{t('listing.notFoundBody')}</p>
        <div className="empty__actions">
          <Link className="button" to="/homes">
            {t('house.all')}
          </Link>
        </div>
      </div>
    );
  }

  const photos = listing.photos;
  const cover = photos[active]?.slug ?? null;

  return (
    <div className="page detail">
      <Link className="backlink" to="/homes">
        <ArrowLeftIcon width={15} height={15} /> {t('house.all')}
      </Link>

      <div className="gallery">
        <div className="gallery__main">
          <ListingPhoto slug={cover} alt={listing.title} />
        </div>
        {photos.length > 1 && (
          <div className="gallery__thumbs">
            {photos.map((photo, index) => (
              <button
                key={photo.slug}
                type="button"
                className={`gallery__thumb ${index === active ? 'is-active' : ''}`}
                aria-pressed={index === active}
                aria-label={t('sell.photoSlot', { n: photo.slot })}
                onClick={() => setActive(index)}
              >
                <ListingPhoto slug={photo.slug} alt="" />
              </button>
            ))}
          </div>
        )}
        <span className="detail__kind">{listing.kind}</span>
      </div>

      <div className="detail__grid">
        <div className="detail__content">
          <div className="detail__titleblock">
            <div>
              <h1>{listing.title}</h1>
              <p className="detail__address">
                <PinIcon width={14} height={14} /> {listing.city}
                {photos.length > 0 ? ` · ${tp('listing.photoCount', photos.length)}` : ''}
              </p>
            </div>
            {listing.price !== undefined && (
              <div className="detail__price">
                {formatPrice(listing.price)}
                <span>{t('price.asking')}</span>
              </div>
            )}
          </div>

          <section className="block">
            <h2>{t('listing.about')}</h2>
            <p className="prose">
              {listing.description || t('listing.noDescription')}
            </p>
          </section>

          {photos.length === 0 && <p className="book__hint">{t('listing.noPhotos')}</p>}

          <section className="block">
            <h2>{t('listing.seller')}</h2>
            <div className="infocard">
              <div>
                <strong>{listing.sellerName ?? 'CasaSigma'}</strong>
                <p>{t('listing.sellerLine')}</p>
              </div>
              <span className="infocard__tag">{listing.kind}</span>
            </div>
          </section>
        </div>

        <aside className="booking" aria-label={t('listing.viewing')}>
          <div className="booking__form">
            <div className="booking__head">
              <h2>{t('listing.viewing')}</h2>
              <span className="booking__free">{t('common.noFee')}</span>
            </div>
            <p className="booking__sub">{t('listing.viewingBody')}</p>
            <Link className="button button--block" to={`/book?listing=${listing.id}`}>
              {t('listing.request')}
            </Link>
            <p className="booking__fine">{t('listing.viewingFine')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
