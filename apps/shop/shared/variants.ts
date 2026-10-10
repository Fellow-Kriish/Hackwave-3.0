export const SHOP_VERSIONS = ['v1', 'v2', 'v2-broken', 'v2-wrong-total'] as const;
export type ShopVersion = (typeof SHOP_VERSIONS)[number];
export type ShopUi = 'v1' | 'v2';

export interface VariantFlags {
  /** Which UI the browser renders. The bug variants render the v2 UI unchanged. */
  ui: ShopUi;
  /** Whether POST /api/orders writes the order to the store. */
  persistOrders: boolean;
  /** Unit prices the order handler stores instead of the catalogue price (bug injection). */
  priceOverrides: Readonly<Record<string, number>>;
  /** Whether shipping.phone is required; v2 adds a required Phone field. */
  requirePhone: boolean;
}

const v1: VariantFlags = { ui: 'v1', persistOrders: true, priceOverrides: {}, requirePhone: false };
const v2: VariantFlags = { ui: 'v2', persistOrders: true, priceOverrides: {}, requirePhone: true };

/** One codebase, one flag per bug: the bug variants are v2 plus a single change in the order handler. */
export const VARIANTS: Readonly<Record<ShopVersion, VariantFlags>> = {
  v1,
  v2,
  'v2-broken': { ...v2, persistOrders: false },
  'v2-wrong-total': { ...v2, priceOverrides: { 'trail-runner': 999 } },
};

export function isShopVersion(value: unknown): value is ShopVersion {
  return typeof value === 'string' && (SHOP_VERSIONS as readonly string[]).includes(value);
}

export function parseShopVersion(value: string | undefined): ShopVersion {
  if (!isShopVersion(value)) {
    throw new Error(`Unknown SHOP_VERSION "${value ?? ''}". Expected one of: ${SHOP_VERSIONS.join(', ')}.`);
  }
  return value;
}
