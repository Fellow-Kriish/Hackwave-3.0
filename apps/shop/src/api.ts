import type { Product } from '../shared/catalogue';
import type { OrderRequest } from '../shared/order';

let products: Product[] | null = null;
let productsRequest: Promise<Product[]> | null = null;

function errorMessage(body: unknown): string | undefined {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : undefined;
}

/** Products already fetched in this page load, so a revisit renders without a loading flash. */
export function cachedProducts(): Product[] | null {
  return products;
}

export function fetchProducts(): Promise<Product[]> {
  productsRequest ??= fetch('/api/products')
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      products = (await response.json()) as Product[];
      return products;
    })
    .catch((error: unknown) => {
      productsRequest = null;
      throw error;
    });
  return productsRequest;
}

export async function placeOrder(order: OrderRequest): Promise<{ id: number }> {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body) ?? `Order failed (HTTP ${response.status})`);
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'number') throw new Error('Unexpected response from the order service');
  return { id };
}
