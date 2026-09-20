// Mirrors the pre-filter in backend/server.py's regex_parse() (PROMO_RE,
// FAILED_PAYMENT_RE, AMOUNT_RE, DEBIT_RE, CREDIT_RE). Google Play's Spyware Policy
// prohibits budgeting apps from exfiltrating non-financial SMS content, so this must
// run on-device before anything is sent to the backend — the backend check alone is
// too late, since the message has already left the phone by then. Keep these patterns
// in sync with server.py if either side changes.

const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i;
const DEBIT_RE = /\b(debited|debit|spent|paid|withdrawn|sent|used for|charged to)\b/i;
const CREDIT_RE = /\b(credited|credit|received|deposited|refunded)\b/i;
const PROMO_RE = /\b(cashback|discount|offer|reward|coupon|t&c\s*apply|apply now|earn up to|get\s+\d+%)\b/i;
const FAILED_PAYMENT_RE =
  /\b(?:has|have)\s+failed\b|\b(?:payment|transaction|txn|transfer)\b.{0,40}?\b(?:declined|unsuccessful)\b|\b(?:declined|unsuccessful)\b.{0,40}?\b(?:payment|transaction|txn|transfer)\b|\bspam\b/i;

// Stockbroker ledger notices ("Dear Client ... With Holding balance") look like credits but
// aren't bank transactions. Mirrors BROKERAGE_RE in backend/server.py.
const BROKERAGE_RE = /\bdear\s+client\b|\bwith\s*holding\s+balance\b|\btrade\s*confirmation\b/i;

export function looksLikeTransaction(text: string): boolean {
  if (PROMO_RE.test(text) || FAILED_PAYMENT_RE.test(text) || BROKERAGE_RE.test(text)) return false;
  if (!AMOUNT_RE.test(text)) return false;
  return DEBIT_RE.test(text) || CREDIT_RE.test(text);
}
