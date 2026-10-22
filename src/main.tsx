import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { LanguageProvider } from './state/LanguageProvider';
import { AuthProvider } from './state/AuthProvider';
import { BookingsProvider } from './state/BookingsProvider';
import './styles.css';

// HashRouter keeps deep links working inside the Capacitor WebView, where the
// app is served from https://localhost with no server-side rewrite rules.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LanguageProvider>
        <AuthProvider>
          <BookingsProvider>
            <App />
          </BookingsProvider>
        </AuthProvider>
      </LanguageProvider>
    </HashRouter>
  </StrictMode>,
);
