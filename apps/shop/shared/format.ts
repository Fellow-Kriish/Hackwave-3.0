/** Formats whole rupees with Indian digit grouping, e.g. 1299 -> "₹1,299", 129900 -> "₹1,29,900". */
export function formatINR(amount: number): string {
  const digits = String(Math.round(Math.abs(amount)));
  const sign = amount < 0 ? '-' : '';
  if (digits.length <= 3) return `${sign}₹${digits}`;
  const lastThree = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${sign}₹${groups.join(',')},${lastThree}`;
}
