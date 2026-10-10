import { parseShopVersion, VARIANTS, type ShopUi, type ShopVersion } from '../shared/variants';

declare global {
  interface Window {
    __SHOP__?: { version?: string };
  }
}

export interface ShopConfig {
  version: ShopVersion;
  ui: ShopUi;
}

/** The server injects window.__SHOP__ into index.html on every request; the build itself knows no version. */
export function readShopConfig(): ShopConfig {
  const version = parseShopVersion(window.__SHOP__?.version);
  return { version, ui: VARIANTS[version].ui };
}
