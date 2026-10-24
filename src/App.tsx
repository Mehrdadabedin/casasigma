import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Houses } from './pages/Houses';
import { HouseDetail } from './pages/HouseDetail';
import { Restaurants } from './pages/Restaurants';
import { RestaurantDetail } from './pages/RestaurantDetail';
import { Book } from './pages/Book';
import { ListingDetail } from './pages/ListingDetail';
import { Profile } from './pages/Profile';
import { Sell } from './pages/Sell';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from './pages/Auth';
import { AdminPage } from './pages/Admin';
import { AdminCredentialsPage } from './pages/AdminCredentials';
import { useI18n } from './state/LanguageProvider';

function TableRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/restaurants/${id}` : '/restaurants'} replace />;
}

function NotFound() {
  const { t } = useI18n();

  return (
    <div className="page page--narrow">
      <p className="eyebrow">404</p>
      <h1>{t('notFound.title')}</h1>
      <p className="pagehead__lede">{t('notFound.lede')}</p>
      <div className="empty__actions">
        <Link className="button" to="/">
          {t('notFound.start')}
        </Link>
        <Link className="button button--ghost" to="/homes">
          {t('notFound.browse')}
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/homes" element={<Houses />} />
        <Route path="/homes/:id" element={<HouseDetail />} />
        {/* Seller-published listings live in Postgres, not the demo catalogue. */}
        <Route path="/listings/:id" element={<ListingDetail />} />
        <Route path="/restaurants" element={<Restaurants />} />
        <Route path="/restaurants/:id" element={<RestaurantDetail />} />
        {/* Old dining links keep working after the switch to sale listings. */}
        <Route path="/tables" element={<TableRedirect />} />
        <Route path="/tables/:id" element={<TableRedirect />} />
        <Route path="/book" element={<Book />} />
        {/* The page used to be called Plans; old links keep working. */}
        <Route path="/plans" element={<Navigate to="/book" replace />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/sell" element={<Sell />} />
        {/* The page renders a 403 for signed-in non-admins; the API checks too. */}
        <Route path="/admin" element={<AdminPage />} />
        {/* Reachable only while signed in as admin; no menu entry. */}
        <Route path="/admin/credentials" element={<AdminCredentialsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        {/* `/reset?token=` is the link the forgotten-password email carries. */}
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
