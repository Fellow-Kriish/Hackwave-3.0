/**
 * Words on a control that commits a goal for good: paying, placing or confirming an order, buying. Only the
 * terminal milestone may click one, whatever it is called now ("Pay ₹1,299" after a redesign renamed "Place order").
 * "Proceed to payment" and "Continue to payment" are not commits: "payment" is not "pay".
 */
const COMMIT_WORDS =
  /\b(?:place (?:the |my |your )?order|pay(?: now| later)?|buy(?: now| it now)?|purchase|(?:complete|confirm|submit|finish) (?:the |my |your )?(?:order|purchase|payment)|check ?out now)\b/i;

export function looksLikeCommit(name: string | undefined): boolean {
  return name !== undefined && COMMIT_WORDS.test(name);
}
