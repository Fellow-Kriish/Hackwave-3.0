import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../shared/catalogue';
import type { ShippingDetails } from '../shared/order';

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export interface PlacedOrder {
  /** The id as this UI displays it: "4821" in v1, "ORD-4821" in v2. */
  ref: string;
  lines: CartLine[];
  total: number;
}

interface ShopState {
  lines: CartLine[];
  count: number;
  total: number;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  notice: string;
  setNotice: (notice: string) => void;
  shipping: ShippingDetails | null;
  setShipping: (shipping: ShippingDetails | null) => void;
  lastOrder: PlacedOrder | null;
  setLastOrder: (order: PlacedOrder | null) => void;
}

const ShopContext = createContext<ShopState | null>(null);
const MAX_QTY = 10;

/** Cart and checkout state live in memory on the client, by design: a reload starts clean. */
export function ShopStateProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState('');
  const [shipping, setShipping] = useState<ShippingDetails | null>(null);
  const [lastOrder, setLastOrder] = useState<PlacedOrder | null>(null);

  const addToCart = useCallback((product: Product) => {
    setLines((current) => {
      if (!current.some((line) => line.productId === product.id)) {
        return [...current, { productId: product.id, name: product.name, price: product.price, qty: 1 }];
      }
      return current.map((line) =>
        line.productId === product.id ? { ...line, qty: Math.min(line.qty + 1, MAX_QTY) } : line,
      );
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const value = useMemo<ShopState>(
    () => ({
      lines,
      count: lines.reduce((sum, line) => sum + line.qty, 0),
      total: lines.reduce((sum, line) => sum + line.price * line.qty, 0),
      addToCart,
      removeFromCart,
      clearCart,
      notice,
      setNotice,
      shipping,
      setShipping,
      lastOrder,
      setLastOrder,
    }),
    [lines, addToCart, removeFromCart, clearCart, notice, shipping, lastOrder],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopState {
  const state = useContext(ShopContext);
  if (!state) throw new Error('useShop must be used inside ShopStateProvider');
  return state;
}
