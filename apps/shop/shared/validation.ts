export interface CardInput {
  number: string;
  expiry: string;
  cvv: string;
  name: string;
}

export interface ShippingInput {
  name: string;
  street: string;
  city: string;
  pincode: string;
  phone: string;
}

export const EMPTY_CARD: CardInput = { number: '', expiry: '', cvv: '', name: '' };
export const EMPTY_SHIPPING: ShippingInput = { name: '', street: '', city: '', pincode: '', phone: '' };

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function digitsOnly(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** Luhn checksum, so "a valid credit card" means the same thing to the shop as to a real gateway. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function validateCard(card: CardInput): FieldErrors<keyof CardInput> {
  const errors: FieldErrors<keyof CardInput> = {};
  const number = digitsOnly(card.number);
  if (!number) errors.number = 'Enter your card number';
  else if (!/^\d{16}$/.test(number) || !passesLuhn(number)) errors.number = 'Enter a valid 16-digit card number';
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry.trim())) errors.expiry = 'Enter the expiry date as MM/YY';
  if (!/^\d{3,4}$/.test(card.cvv.trim())) errors.cvv = 'Enter the 3 or 4 digit CVV';
  if (!card.name.trim()) errors.name = 'Enter the name on the card';
  return errors;
}

export function validateShipping(
  shipping: ShippingInput,
  options: { requirePhone: boolean },
): FieldErrors<keyof ShippingInput> {
  const errors: FieldErrors<keyof ShippingInput> = {};
  if (!shipping.name.trim()) errors.name = 'Enter your full name';
  if (!shipping.street.trim()) errors.street = 'Enter your street address';
  if (!shipping.city.trim()) errors.city = 'Enter your city';
  if (!/^\d{6}$/.test(shipping.pincode.trim())) errors.pincode = 'Enter a 6-digit pincode';
  if (options.requirePhone) {
    const phone = digitsOnly(shipping.phone);
    if (!phone) errors.phone = 'Enter your phone number';
    else if (!/^\d{10}$/.test(phone)) errors.phone = 'Enter a 10-digit phone number';
  }
  return errors;
}

export function errorMessages(errors: Partial<Record<string, string>>): string[] {
  return Object.values(errors).filter((message): message is string => Boolean(message));
}

export function cardLast4(cardNumber: string): string {
  return digitsOnly(cardNumber).slice(-4);
}
