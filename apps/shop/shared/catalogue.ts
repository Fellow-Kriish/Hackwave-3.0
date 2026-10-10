export interface Product {
  id: string;
  name: string;
  /** Price in whole rupees. */
  price: number;
  description: string;
}

/** Fixed catalogue: four products, INR prices, shipping free, no discounts. Trail Runner is the demo product. */
export const PRODUCTS: readonly Product[] = [
  {
    id: 'trail-runner',
    name: 'Trail Runner',
    price: 1299,
    description: 'Light, grippy and ready for muddy weekend trails.',
  },
  {
    id: 'city-sneaker',
    name: 'City Sneaker',
    price: 1899,
    description: 'Clean leather upper for everyday wear.',
  },
  {
    id: 'canvas-slip-on',
    name: 'Canvas Slip-On',
    price: 849,
    description: 'Breathable canvas with no laces to tie.',
  },
  {
    id: 'summit-boot',
    name: 'Summit Boot',
    price: 2499,
    description: 'Waterproof hiking boot with ankle support.',
  },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}
