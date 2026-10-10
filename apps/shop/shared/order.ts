/** Ids come from a counter; after a reset the first order is always 4821. */
export const FIRST_ORDER_ID = 4821;

export interface ShippingDetails {
  name: string;
  street: string;
  city: string;
  pincode: string;
  phone?: string;
}

/** Body of POST /api/orders. */
export interface OrderRequest {
  items: { productId: string; qty: number }[];
  shipping: ShippingDetails;
  cardLast4: string;
  /** The total the shopper saw, in whole rupees. */
  total: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
}

/** A record in the orders store, the system of record the verifier reads. */
export interface Order {
  id: number;
  items: OrderItem[];
  total: number;
  cardLast4: string;
  shipping: ShippingDetails;
}
