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
  // Stable id used for React keys / mutations; unique per (product, variation) combo.
  lineId: string;
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  unitAmountCents: number;
  currency: string;
  fulfillmentType: StoreProduct['fulfillment_type'];
  kind: StoreProduct['kind'];
  quantity: number;
  selectedVariations: Record<string, string> | null;
}

function variationKey(selectedVariations: Record<string, string> | null | undefined): string {
  if (!selectedVariations) return '';
  return Object.keys(selectedVariations)
    .sort()
    .map((key) => `${key}=${selectedVariations[key]}`)
    .join('|');
}

function buildLineId(productId: string, selectedVariations: Record<string, string> | null | undefined): string {
  const key = variationKey(selectedVariations);
  return key ? `${productId}::${key}` : productId;
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
  add: (
    product: StoreProduct,
    quantity?: number,
    selectedVariations?: Record<string, string> | null
  ) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
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
    return parsed.lines
      .filter(
        (line): line is CartLine =>
          typeof line.productId === 'string' &&
          typeof line.quantity === 'number' &&
          line.quantity > 0
      )
      .map((line) => ({
        ...line,
        selectedVariations: line.selectedVariations ?? null,
        lineId: line.lineId ?? buildLineId(line.productId, line.selectedVariations ?? null),
      }));
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

  const add = useCallback(
    (
      product: StoreProduct,
      quantity = 1,
      selectedVariations: Record<string, string> | null = null
    ) => {
      if (quantity <= 0) return;
      const lineId = buildLineId(product.id, selectedVariations);
      setLines((current) => {
        const existing = current.find((line) => line.lineId === lineId);
        if (existing) {
          return current.map((line) =>
            line.lineId === lineId ? { ...line, quantity: line.quantity + quantity } : line
          );
        }
        return [
          ...current,
          {
            lineId,
            productId: product.id,
            slug: product.slug,
            name: product.name,
            imageUrl: product.image_url,
            unitAmountCents: product.unit_amount_cents,
            currency: product.currency,
            fulfillmentType: product.fulfillment_type,
            kind: product.kind,
            quantity,
            selectedVariations,
          },
        ];
      });
    },
    []
  );

  const setQuantity = useCallback((lineId: string, quantity: number) => {
    setLines((current) => {
      if (quantity <= 0) {
        return current.filter((line) => line.lineId !== lineId);
      }
      return current.map((line) =>
        line.lineId === lineId ? { ...line, quantity } : line
      );
    });
  }, []);

  const remove = useCallback((lineId: string) => {
    setLines((current) => current.filter((line) => line.lineId !== lineId));
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
