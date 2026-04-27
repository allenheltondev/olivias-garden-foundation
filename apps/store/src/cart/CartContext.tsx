import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { StoreProduct } from '../api';

const STORAGE_KEY = 'og-store-cart-v1';

export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  unitAmountCents: number;
  currency: string;
  fulfillmentType: StoreProduct['fulfillment_type'];
  kind: StoreProduct['kind'];
  quantity: number;
}

interface StoredCart {
  version: 1;
  lines: CartLine[];
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  requiresShipping: boolean;
  add: (product: StoreProduct, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function readStoredCart(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCart;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.lines)) return [];
    return parsed.lines.filter(
      (line): line is CartLine =>
        typeof line.productId === 'string' &&
        typeof line.quantity === 'number' &&
        line.quantity > 0
    );
  } catch {
    return [];
  }
}

function writeStoredCart(lines: CartLine[]) {
  try {
    const payload: StoredCart = { version: 1, lines };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / privacy errors
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => readStoredCart());

  useEffect(() => {
    writeStoredCart(lines);
  }, [lines]);

  const add = useCallback((product: StoreProduct, quantity = 1) => {
    if (quantity <= 0) return;
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: line.quantity + quantity }
            : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          imageUrl: product.image_url,
          unitAmountCents: product.unit_amount_cents,
          currency: product.currency,
          fulfillmentType: product.fulfillment_type,
          kind: product.kind,
          quantity,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) => {
      if (quantity <= 0) {
        return current.filter((line) => line.productId !== productId);
      }
      return current.map((line) =>
        line.productId === productId ? { ...line, quantity } : line
      );
    });
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotalCents = lines.reduce(
      (sum, line) => sum + line.unitAmountCents * line.quantity,
      0
    );
    const requiresShipping = lines.some((line) => line.fulfillmentType === 'shipping');
    return {
      lines,
      itemCount,
      subtotalCents,
      requiresShipping,
      add,
      setQuantity,
      remove,
      clear,
    };
  }, [lines, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used inside CartProvider');
  }
  return ctx;
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
