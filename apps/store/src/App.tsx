import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { loadStoreSession, type StoreSession } from './auth/session';
import { CartProvider } from './cart/CartContext';
import { AppShell } from './shell/AppShell';
import { BrowsePage } from './pages/BrowsePage';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/CartPage';
import { OrderCompletePage } from './pages/OrderCompletePage';
import { OrdersPage } from './pages/OrdersPage';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';

function redirectToLogin() {
  const returnUrl = window.location.href;
  window.location.assign(
    `${foundationHomeUrl}/login?redirect=${encodeURIComponent(returnUrl)}`
  );
}

export default function App() {
  const [session, setSession] = useState<StoreSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    void loadStoreSession().then((next) => {
      if (!mounted) return;
      setSession(next);
      setIsLoadingSession(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSignIn = useCallback(() => {
    redirectToLogin();
  }, []);

  if (isLoadingSession) {
    return (
      <div className="store-fullpage">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <CartProvider>
      <AppShell session={session} onSignIn={handleSignIn}>
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/products/:slug" element={<ProductPage />} />
          <Route path="/cart" element={<CartPage session={session} />} />
          <Route path="/order-complete" element={<OrderCompletePage />} />
          <Route
            path="/orders"
            element={
              session ? <OrdersPage session={session} /> : <Navigate to="/" replace />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </CartProvider>
  );
}
