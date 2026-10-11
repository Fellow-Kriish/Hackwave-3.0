/** Formatting an app adds to what was typed: spaces in a card number, dashes and brackets in a phone mask. */
const FORMATTING = /[\s\-./()]/g;

/** Does a field hold the value typed into it, allowing for the app's formatting ("4242 4242" as "42424242")? */
export function sameValue(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const plain = (text: string) => text.replace(FORMATTING, '').toLowerCase();
  return plain(expected) !== '' && plain(actual) === plain(expected);
}
