import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Houses } from './pages/Houses';
import { HouseDetail } from './pages/HouseDetail';
import { Restaurants } from './pages/Restaurants';
import { RestaurantDetail } from './pages/RestaurantDetail';
import { Plans } from './pages/Plans';
import { LoginPage, SignupPage } from './pages/Auth';
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
        <Route path="/restaurants" element={<Restaurants />} />
        <Route path="/restaurants/:id" element={<RestaurantDetail />} />
        {/* Old dining links keep working after the switch to sale listings. */}
        <Route path="/tables" element={<TableRedirect />} />
        <Route path="/tables/:id" element={<TableRedirect />} />
        <Route path="/plans" element={<Plans />} />
        {/* The page renders a 403 for signed-in non-admins; the API checks too. */}
        <Route path="/admin" element={<AdminPage />} />
        {/* Reachable only while signed in as admin; no menu entry. */}
        <Route path="/admin/credentials" element={<AdminCredentialsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
