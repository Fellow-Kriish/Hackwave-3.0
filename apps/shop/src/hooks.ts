import { useEffect, useState } from 'react';
import type { Product } from '../shared/catalogue';
import { cachedProducts, fetchProducts } from './api';

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function useProducts(): { products: Product[] | null; error: string | null } {
  const [products, setProducts] = useState<Product[] | null>(cachedProducts);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchProducts().then(
      (list) => {
        if (active) setProducts(list);
      },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return { products, error };
}
