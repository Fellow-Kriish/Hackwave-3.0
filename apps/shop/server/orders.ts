import { findProduct, type Product } from '../shared/catalogue';
import type { Order, ShippingDetails } from '../shared/order';
import type { VariantFlags } from '../shared/variants';

export interface ParsedOrder {
  lines: { product: Product; qty: number }[];
  shipping: ShippingDetails;
  cardLast4: string;
  total: number;
}

export type ParseResult = { ok: true; value: ParsedOrder } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const fail = (error: string): ParseResult => ({ ok: false, error });

export function parseOrderRequest(body: unknown, flags: VariantFlags): ParseResult {
  if (!isRecord(body)) return fail('Request body must be a JSON object');

  const { items, shipping, cardLast4, total } = body;
  if (!Array.isArray(items) || items.length === 0) return fail('items must be a non-empty array');
  const lines: ParsedOrder['lines'] = [];
  for (const item of items) {
    if (!isRecord(item)) return fail('Each item must be an object');
    const product = typeof item.productId === 'string' ? findProduct(item.productId) : undefined;
    if (!product) return fail(`Unknown product "${String(item.productId)}"`);
    if (lines.some((line) => line.product.id === product.id)) return fail(`${product.name} appears twice in items`);
    const qty = item.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 10) {
      return fail('qty must be a whole number from 1 to 10');
    }
    lines.push({ product, qty });
  }

  if (!isRecord(shipping)) return fail('shipping is required');
  const address: ShippingDetails = {
    name: text(shipping.name),
    street: text(shipping.street),
    city: text(shipping.city),
    pincode: text(shipping.pincode),
  };
  if (!address.name || !address.street || !address.city) return fail('shipping name, street and city are required');
  if (!/^\d{6}$/.test(address.pincode)) return fail('shipping pincode must be 6 digits');
  const phone = text(shipping.phone);
  if (flags.requirePhone || phone) {
    if (!/^\d{10}$/.test(phone)) return fail('shipping phone must be 10 digits');
    address.phone = phone;
  }

  if (typeof cardLast4 !== 'string' || !/^\d{4}$/.test(cardLast4)) return fail('cardLast4 must be 4 digits');
  if (typeof total !== 'number' || !Number.isFinite(total)) return fail('total must be a number');

  return { ok: true, value: { lines, shipping: address, cardLast4, total } };
}

export function catalogueTotal(order: ParsedOrder): number {
  return order.lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
}

/** The record the order handler stores. priceOverrides is where the v2-wrong-total bug lives. */
export function buildOrderRecord(order: ParsedOrder, flags: VariantFlags): Omit<Order, 'id'> {
  const items = order.lines.map(({ product, qty }) => ({
    productId: product.id,
    name: product.name,
    qty,
    unitPrice: flags.priceOverrides[product.id] ?? product.price,
  }));
  return {
    items,
    total: items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0),
    cardLast4: order.cardLast4,
    shipping: order.shipping,
  };
}
