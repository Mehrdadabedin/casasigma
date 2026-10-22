import { Link, useParams } from 'react-router-dom';
import { restaurants } from '../data/restaurants';
import { useAuth } from '../state/AuthProvider';
import { useI18n } from '../state/LanguageProvider';
import { Photo } from '../components/Photo';
import { Rating } from '../components/cards';
import { ArrowLeftIcon, PinIcon } from '../components/icons';
import { formatPrice } from '../lib/format';

export function RestaurantDetail() {
  const { id } = useParams<{ id: string }>();
  const restaurant = restaurants.find((candidate) => candidate.id === id);
  const { user, ready } = useAuth();
  const { t } = useI18n();

  if (!restaurant) {
    return (
      <div className="page">
        <p className="eyebrow">{t('house.notFound')}</p>
        <h1>{t('restaurant.notFound')}</h1>
        <Link className="button" to="/restaurants">
          {t('restaurant.backAll')}
        </Link>
      </div>
    );
  }

  const contactHref = `/login?next=${encodeURIComponent(`/restaurants/${restaurant.id}`)}`;
  const mailto = restaurant.agent.email
    ? `mailto:${restaurant.agent.email}?subject=${encodeURIComponent(
        t('restaurant.emailSubject', {
          name: restaurant.name,
          price: formatPrice(restaurant.price),
        }),
      )}`
    : undefined;

  return (
    <div className="page detail">
      <Link className="backlink" to="/restaurants">
        <ArrowLeftIcon width={15} height={15} /> {t('restaurant.all')}
      </Link>

      <div className="detail__gallery">
        <Photo gradient={restaurant.gradient} label={restaurant.name} className="photo--hero" />
        <div className="detail__thumbs">
          <Photo gradient={[restaurant.gradient[1], restaurant.gradient[0]]} className="photo--thumb" />
          <Photo gradient={['#f0e6d8', restaurant.gradient[0]]} className="photo--thumb" />
          <Photo gradient={[restaurant.gradient[0], '#f7f1e8']} className="photo--thumb" />
        </div>
        <span className="detail__kind">{restaurant.cuisine}</span>
      </div>

      <div className="detail__grid">
        <div className="detail__content">
          <div className="detail__titleblock">
            <div>
              <p className="eyebrow">{t('restaurant.forSale')}</p>
              <h1>{restaurant.name}</h1>
              <p className="detail__address">
                <PinIcon width={14} height={14} /> {restaurant.address}, {restaurant.neighborhood},{' '}
                {restaurant.city}
              </p>
            </div>
            <div className="detail__price">
              {formatPrice(restaurant.price)}
              <span>
                {t('restaurant.askingWith', { tenure: t(`tenure.${restaurant.tenure}`) })}
              </span>
            </div>
          </div>

          <div className="facts">
            <span>🍽️ {t('restaurant.seats', { n: restaurant.seats })}</span>
            <span>🕒 {restaurant.hours}</span>
            <span>{restaurant.cuisine}</span>
            <span>
              <Rating value={restaurant.rating} count={restaurant.reviewCount} />
            </span>
          </div>

          <section className="block">
            <h2>{t('restaurant.about')}</h2>
            <p className="prose">{restaurant.description}</p>
          </section>

          <section className="block">
            <h2>{t('restaurant.included')}</h2>
            <ul className="chips">
              {restaurant.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>

          <section className="block">
            <h2>{t('restaurant.viewing')}</h2>
            <div className="infocard">
              <div>
                <strong>{restaurant.hours}</strong>
                <p>{t('restaurant.viewingBody')}</p>
              </div>
              <span className="infocard__tag">{restaurant.neighborhood}</span>
            </div>
          </section>

          <section className="block">
            <h2>{t('restaurant.seller')}</h2>
            <div className="agent">
              <span className="agent__avatar" aria-hidden="true">
                {restaurant.agent.name
                  .split(' ')
                  .map((part) => part[0])
                  .join('')}
              </span>
              <div>
                <strong>{restaurant.agent.name}</strong>
                <p>{t('restaurant.sellerLine')}</p>
              </div>
              {/* Seller contact is reserved for signed-in buyers, matching the
                  promise in restaurant.contactSub; admins can pause it per account
                  by clearing canBuy. */}
              {ready && user?.canBuy && (
                <a
                  className="button button--ghost"
                  href={`tel:${restaurant.agent.phone.replace(/\s/g, '')}`}
                >
                  {t('common.call')}
                </a>
              )}
            </div>
          </section>
        </div>

        <aside className="booking" aria-label={t('restaurant.contactAria')}>
          <div className="booking__head">
            <h2>{t('restaurant.arrange')}</h2>
            <span className="booking__free">{t('common.noFee')}</span>
          </div>

          {!ready ? (
            <p className="booking__sub">{t('restaurant.checking')}</p>
          ) : user && user.canBuy ? (
            <>
              <p className="booking__sub">
                {t('restaurant.signedIn', {
                  name: user.name,
                  seller: restaurant.agent.name,
                })}
              </p>
              <a
                className="button button--block"
                href={`tel:${restaurant.agent.phone.replace(/\s/g, '')}`}
              >
                {t('restaurant.callSeller', { seller: restaurant.agent.name })}
              </a>
              {mailto && (
                <a className="button button--ghost button--block" href={mailto}>
                  {t('restaurant.emailSeller')}
                </a>
              )}
              <p className="booking__fine">
                {restaurant.agent.phone}
                {restaurant.agent.email ? ` · ${restaurant.agent.email}` : ''}
              </p>
            </>
          ) : user ? (
            // Signed in, but an admin has paused buying for this account.
            <>
              <p className="booking__sub">{t('restaurant.buyingBlocked')}</p>
              <p className="booking__fine">{t('restaurant.buyingBlockedFine')}</p>
            </>
          ) : (
            <>
              <p className="booking__sub">{t('restaurant.contactSub')}</p>
              <Link className="button button--block" to={contactHref}>
                {t('restaurant.signInContact')}
              </Link>
              <Link
                className="textlink textlink--center"
                to={`/signup?next=${encodeURIComponent(`/restaurants/${restaurant.id}`)}`}
              >
                {t('restaurant.createAccount')}
              </Link>
              <p className="booking__fine">{t('restaurant.contactFine')}</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
