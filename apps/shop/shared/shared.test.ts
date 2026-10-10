import { describe, expect, it } from 'vitest';
import { formatINR } from './format';
import { parseShopVersion, VARIANTS } from './variants';
import { cardLast4, passesLuhn, validateCard, validateShipping } from './validation';

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(849)).toBe('₹849');
    expect(formatINR(1299)).toBe('₹1,299');
    expect(formatINR(129900)).toBe('₹1,29,900');
    expect(formatINR(12345678)).toBe('₹1,23,45,678');
  });
});

describe('variants', () => {
  it('derives each bug variant from v2 by exactly one flag', () => {
    const { persistOrders: brokenPersist, ...brokenRest } = VARIANTS['v2-broken'];
    const { persistOrders: v2Persist, ...v2Rest } = VARIANTS.v2;
    expect(brokenPersist).toBe(false);
    expect(v2Persist).toBe(true);
    expect(brokenRest).toEqual(v2Rest);

    const { priceOverrides: wrongOverrides, ...wrongRest } = VARIANTS['v2-wrong-total'];
    const { priceOverrides: v2Overrides, ...v2WithoutOverrides } = VARIANTS.v2;
    expect(v2Overrides).toEqual({});
    expect(wrongOverrides).toEqual({ 'trail-runner': 999 });
    expect(wrongRest).toEqual(v2WithoutOverrides);
  });

  it('rejects unknown versions loudly', () => {
    expect(parseShopVersion('v2-broken')).toBe('v2-broken');
    expect(() => parseShopVersion('v3')).toThrow(/Unknown SHOP_VERSION/);
    expect(() => parseShopVersion(undefined)).toThrow(/Unknown SHOP_VERSION/);
  });
});

describe('validation', () => {
  const card = { number: '4242 4242 4242 4242', expiry: '12/29', cvv: '123', name: 'Kartik Test' };
  const shipping = { name: 'Kartik Test', street: '12 MG Road', city: 'Indore', pincode: '452001', phone: '' };

  it('accepts the demo card', () => {
    expect(passesLuhn('4242424242424242')).toBe(true);
    expect(validateCard(card)).toEqual({});
    expect(cardLast4(card.number)).toBe('4242');
  });

  it('rejects a card that fails the Luhn check', () => {
    expect(validateCard({ ...card, number: '4242 4242 4242 4241' }).number).toMatch(/valid 16-digit/);
  });

  it('requires a phone only when asked to', () => {
    expect(validateShipping(shipping, { requirePhone: false })).toEqual({});
    expect(validateShipping(shipping, { requirePhone: true }).phone).toBe('Enter your phone number');
    expect(validateShipping({ ...shipping, phone: '98765 43210' }, { requirePhone: true })).toEqual({});
  });
});
