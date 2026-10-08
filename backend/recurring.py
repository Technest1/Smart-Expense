"""Recurring-payment detection + upcoming-expense projection.

Pure functions (no DB, no network) so they are trivially testable. Nothing here is
persisted: patterns are recomputed from the transaction ledger on every read and only
the user's decisions (confirm / dismiss / pause / skip / edits) are stored, in
`recurring_prefs`. Consequences:
  * no duplicate patterns or upcoming rows can ever exist (idempotent by construction);
  * an upcoming expense can't double-count with its real transaction: next date is always
    derived from the latest *actual* transaction, so it rolls forward when that arrives.
ponytail: recompute-on-read is O(user transactions) per call; add a cached/queued job if a
user ever has >~20k debits in the lookback window.
"""
import hashlib
import statistics
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

# (name, min_days, max_days) -- tolerances from the product spec, tune here.
FREQUENCIES = [
    ("WEEKLY", 6, 8),
    ("FORTNIGHTLY", 12, 16),
    ("MONTHLY", 25, 35),
    ("QUARTERLY", 80, 100),
    ("HALF_YEARLY", 165, 195),
    ("YEARLY", 330, 400),
]
PERIOD_DAYS = {"WEEKLY": 7, "FORTNIGHTLY": 14, "MONTHLY": 30, "QUARTERLY": 91,
               "HALF_YEARLY": 182, "YEARLY": 365}
PERIOD_MONTHS = {"MONTHLY": 1, "QUARTERLY": 3, "HALF_YEARLY": 6, "YEARLY": 12}
GRACE_DAYS = 5
# Merchant keys that are really a payment mode / unparsed payee: many different payees share
# them, so grouping on them would invent patterns. (Found on real SMS: 'Unknown' merged 7 payees.)
GENERIC_MERCHANTS = {"unknown", "bank", "upi", "neft", "imps", "rtgs", "atm", "cheque", "payment", "transfer"}
MAX_AMOUNT_SPREAD = 0.75   # (max-min)/median above this is not "variable bill", it's noise
LOOKBACK_DAYS = 760        # enough for 2 yearly occurrences


def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    return date(y, m, 28)


def next_after(d: date, freq: str) -> date:
    if freq in PERIOD_MONTHS:
        return add_months(d, PERIOD_MONTHS[freq])
    return d + timedelta(days=PERIOD_DAYS[freq])


def pattern_id(user_id: str, account: str, merchant_key: str) -> str:
    return hashlib.sha1(f"{user_id}|{account}|{merchant_key}".encode()).hexdigest()[:16]


def _frequency(intervals: List[int]):
    best, best_n = None, 0
    for name, lo, hi in FREQUENCIES:
        k = sum(lo <= i <= hi for i in intervals)
        if k > best_n:
            best, best_n = name, k
    return best, (best_n / len(intervals) if intervals else 0.0)


def detect(user_id: str, txns: List[dict], now: datetime, merchant_key) -> List[dict]:
    """txns: debit, non-duplicate dicts with id, merchant, amount, txn_date(datetime),
    account, category. Returns one pattern per (account, merchant)."""
    groups: Dict[tuple, List[dict]] = {}
    for t in txns:
        key = merchant_key(t.get("merchant", ""))
        if not key or key in GENERIC_MERCHANTS:
            continue
        groups.setdefault((t.get("account") or "", key), []).append(t)

    today = now.date()
    out = []
    for (account, mkey), rows in groups.items():
        rows = sorted(rows, key=lambda r: r["txn_date"])
        dates = [r["txn_date"].date() for r in rows]
        n = len(rows)
        intervals = [(b - a).days for a, b in zip(dates, dates[1:])]
        if n < 2:
            continue
        freq, consistency = _frequency(intervals)
        if freq is None:
            continue
        # 3+ occurrences needed; the one exception is a yearly pair, kept as a LOW candidate.
        if n < 3 and not (n == 2 and freq == "YEARLY"):
            continue
        if n >= 3 and consistency < 0.6:
            continue
        # a pattern whose last payment is long past is lapsed, not "upcoming"
        if (today - dates[-1]).days > 2.5 * PERIOD_DAYS[freq]:
            continue

        recent = [r["amount"] for r in rows[-5:]]
        med = statistics.median(recent)
        if med <= 0:
            continue
        spread = (max(recent) - min(recent)) / med
        if spread > MAX_AMOUNT_SPREAD:
            continue
        fixed = spread <= 0.05
        if n >= 5 and consistency >= 0.8 and spread <= 0.35:
            conf = "HIGH"
        elif n >= 3:
            conf = "MEDIUM"
        else:
            conf = "LOW"

        last = rows[-1]
        cats = [r.get("category") for r in rows if r.get("category") and r["category"] != "Uncategorized"]
        out.append({
            "id": pattern_id(user_id, account, mkey),
            "merchant": last["merchant"],
            "merchant_key": mkey,
            "account": account or None,
            "category": cats[-1] if cats else "Uncategorized",
            "frequency": freq,
            "amount_type": "FIXED" if fixed else "VARIABLE",
            "expected_amount": round(med, 2),
            "amount_min": min(recent),
            "amount_max": max(recent),
            "last_date": dates[-1],
            "last_amount": last["amount"],
            "first_date": dates[0],
            "occurrence_count": n,
            "confidence": conf,
            "status": "DETECTED",
            "history": [{"date": r["txn_date"].date().isoformat(), "amount": r["amount"],
                         "transaction_id": r.get("id")} for r in rows[-6:]][::-1],
        })
    return out


def apply_prefs(p: dict, pref: Optional[dict]) -> dict:
    """Overlay the user's stored decisions/edits on a detected pattern."""
    p = dict(p)
    pref = pref or {}
    for k in ("category", "frequency", "expected_amount", "merchant"):
        if pref.get(k) not in (None, ""):
            p[k] = pref[k]
    if pref.get("expected_amount") is not None:
        p["amount_type"] = "FIXED"
    p["status"] = pref.get("status", "DETECTED")
    p["notify"] = pref.get("notify", True)
    p["skipped"] = set(pref.get("skipped", []))
    # an edited next date only holds until a newer real payment makes it stale
    nd = pref.get("next_date")
    if nd and date.fromisoformat(nd) > p["last_date"]:
        p["next_date"] = date.fromisoformat(nd)
    else:
        p["next_date"] = next_after(p["last_date"], p["frequency"])
    return p


def is_upcoming_eligible(p: dict) -> bool:
    """Confirmed patterns, plus unconfirmed HIGH-confidence ones so a new user sees value
    immediately. Paused/dismissed/ended never project."""
    return p["status"] == "ACTIVE" or (p["status"] == "DETECTED" and p["confidence"] == "HIGH")


def project(patterns: List[dict], today: date, days: int) -> List[dict]:
    """Expected future payments within `days`. A payment overdue by more than GRACE_DAYS
    is reported once as MISSED (excluded from totals); skipped occurrences are dropped."""
    horizon = today + timedelta(days=days)
    out = []
    for p in patterns:
        if not is_upcoming_eligible(p):
            continue
        d, first = p["next_date"], True
        while d <= horizon:
            iso = d.isoformat()
            if iso not in p["skipped"]:
                missed = d < today - timedelta(days=GRACE_DAYS)
                if not missed or first:
                    out.append({
                        "recurring_id": p["id"], "merchant": p["merchant"],
                        "category": p["category"], "account": p["account"],
                        "expected_amount": p["expected_amount"], "amount_type": p["amount_type"],
                        "expected_date": iso, "confidence": p["confidence"],
                        "status": "MISSED" if missed else "EXPECTED",
                    })
            first = False
            d = next_after(d, p["frequency"])
    out.sort(key=lambda x: x["expected_date"])
    return out


def summarize(upcoming: List[dict], today: date) -> dict:
    res = {}
    for days in (7, 30, 90):
        cutoff = (today + timedelta(days=days)).isoformat()
        rows = [u for u in upcoming if u["status"] == "EXPECTED" and u["expected_date"] <= cutoff]
        res[f"next_{days}_days"] = round(sum(u["expected_amount"] for u in rows), 2)
        res[f"count_{days}_days"] = len(rows)
    return res
