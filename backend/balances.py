"""Per-account balance: the last balance an SMS reported, rolled forward by later transactions.

Most debit alerts don't print the available balance, so using only the last printed balance
would never move after spending. Starting from the latest transaction that *did* report a
balance (the anchor), later transactions without one are applied: credits add, debits subtract.
The result is flagged as an estimate whenever any adjustment was applied.

Only transactions on a later *day* than the anchor are applied. SMS carry a date but no time,
so a same-day transaction may already be inside the anchor's balance; skipping it avoids
counting it twice (a possible small under-count is preferred to a double count).
"""
from datetime import datetime
from typing import List, Optional


def _day(d):
    return d.date() if isinstance(d, datetime) else d


def running_balance(rows: List[dict]) -> Optional[dict]:
    """rows: one account's non-duplicate transactions, oldest first, with txn_date, direction,
    amount, balance_after. Returns None when no transaction ever reported a balance."""
    anchor = None
    for i, r in enumerate(rows):
        if r.get("balance_after") is not None:
            anchor = i
    if anchor is None:
        return None
    a = rows[anchor]
    bal = float(a["balance_after"])
    adjusted = 0
    for r in rows[anchor + 1:]:
        if r.get("balance_after") is not None:
            continue  # can't happen after the latest anchor, kept for safety
        if _day(r["txn_date"]) <= _day(a["txn_date"]):
            continue
        bal += r["amount"] if r["direction"] == "credit" else -r["amount"]
        adjusted += 1
    return {"balance": round(bal, 2), "as_of": a["txn_date"], "adjusted": adjusted, "estimated": adjusted > 0}
