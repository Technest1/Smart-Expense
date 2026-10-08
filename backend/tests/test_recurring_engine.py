"""Pure-engine tests for recurring.py (no Mongo / network).
Run: pytest --noconftest backend/tests/test_recurring_engine.py
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import recurring as R  # noqa: E402


def mkey(m):  # same normalisation as server._merchant_key
    import re
    toks = [t for t in re.split(r"[\s.,\-_]+", (m or "").lower().strip())
            if t and t not in {"india", "pvt", "ltd", "the", "inc"}]
    return toks[0] if toks else ""


def tx(merchant, amount, d, account="HDFC XX4821", cat="Subscriptions", i=[0]):
    i[0] += 1
    return {"id": f"t{i[0]}", "merchant": merchant, "amount": amount, "account": account,
            "category": cat, "txn_date": datetime(d.year, d.month, d.day, tzinfo=timezone.utc)}


NOW = datetime(2026, 9, 20, tzinfo=timezone.utc)
TODAY = NOW.date()


def detect(txns):
    return R.detect("u1", txns, NOW, mkey)


def test_fixed_monthly():
    p, = detect([tx("Netflix", 649, date(2026, 7, 10)), tx("Netflix", 649, date(2026, 8, 11)),
                 tx("Netflix", 649, date(2026, 9, 10))])
    assert (p["frequency"], p["amount_type"], p["expected_amount"], p["confidence"]) == \
           ("MONTHLY", "FIXED", 649, "MEDIUM")
    assert R.apply_prefs(p, None)["next_date"] == date(2026, 10, 10)


def test_variable_monthly_uses_median():
    rows = [tx("Electricity", a, d) for a, d in
            [(2100, date(2026, 5, 10)), (2450, date(2026, 6, 11)), (1980, date(2026, 7, 9)),
             (2760, date(2026, 8, 10)), (2300, date(2026, 9, 10))]]
    p, = detect(rows)
    assert p["amount_type"] == "VARIABLE" and p["expected_amount"] == 2300 and p["confidence"] == "HIGH"


def test_two_occurrences_not_detected_but_yearly_pair_is_low():
    assert detect([tx("Gym", 500, date(2026, 8, 1)), tx("Gym", 500, date(2026, 9, 1))]) == []
    p, = detect([tx("Insurance", 18200, date(2025, 3, 20)), tx("Insurance", 18500, date(2026, 3, 21))])
    assert p["frequency"] == "YEARLY" and p["confidence"] == "LOW"


def test_one_off_and_erratic_not_recurring():
    assert detect([tx("Amazon", 4500, date(2026, 9, 5))]) == []
    erratic = [tx("Amazon", a, d) for a, d in [(300, date(2026, 6, 1)), (9000, date(2026, 7, 3)),
                                               (150, date(2026, 8, 2))]]
    assert detect(erratic) == []


def test_weekly_quarterly_and_lapsed():
    wk = [tx("Milk", 120, date(2026, 8, 30) + timedelta(days=7 * k)) for k in range(4)]
    assert detect(wk)[0]["frequency"] == "WEEKLY"
    qt = [tx("Water", 400, d) for d in (date(2026, 1, 5), date(2026, 4, 5), date(2026, 7, 5))]
    assert detect(qt)[0]["frequency"] == "QUARTERLY"
    old = [tx("OldSub", 99, d) for d in (date(2025, 1, 5), date(2025, 2, 5), date(2025, 3, 5))]
    assert detect(old) == []  # stopped long ago -> not upcoming


def test_accounts_kept_separate_and_ids_stable():
    a = [tx("Netflix", 649, date(2026, m, 10), account="HDFC XX1") for m in (6, 7, 8)]
    b = [tx("Netflix", 649, date(2026, m, 10), account="ICICI XX2") for m in (6, 7, 8)]
    ps = detect(a + b)
    assert len(ps) == 2 and len({p["id"] for p in ps}) == 2
    assert {p["id"] for p in detect(b + a)} == {p["id"] for p in ps}  # idempotent


def _active(txns, pref=None):
    p, = detect(txns)
    return R.apply_prefs(p, {"status": "ACTIVE", **(pref or {})})


NETFLIX = [tx("Netflix", 649, date(2026, m, 12)) for m in (6, 7, 8, 9)]


def test_projection_summary_and_reconciliation_rolls_forward():
    p = _active(NETFLIX)  # last 12 Sep -> next 12 Oct
    up = R.project([p], TODAY, 90)
    assert [u["expected_date"] for u in up] == ["2026-10-12", "2026-11-12", "2026-12-12"]
    s = R.summarize(up, TODAY)
    assert s["next_7_days"] == 0 and s["next_30_days"] == 649 and s["next_90_days"] == 649 * 3
    # the real October payment arrives -> same engine now projects from it, no double count
    p2 = _active(NETFLIX + [tx("Netflix", 649, date(2026, 10, 12))])
    assert R.project([p2], date(2026, 10, 13), 30)[0]["expected_date"] == "2026-11-12"


def test_missed_after_grace_skip_pause_dismiss():
    p = _active(NETFLIX)  # next 12 Oct
    late = date(2026, 10, 20)  # 8 days overdue > 5-day grace
    up = R.project([p], late, 30)
    assert up[0]["status"] == "MISSED" and R.summarize(up, late)["next_30_days"] == 649  # Nov only
    within = R.project([p], date(2026, 10, 15), 7)
    assert within[0]["status"] == "EXPECTED"  # inside grace: still expected
    skipped = _active(NETFLIX, {"skipped": ["2026-10-12"]})
    assert [u["expected_date"] for u in R.project([skipped], TODAY, 60)] == ["2026-11-12"]
    assert skipped["next_date"] == date(2026, 11, 12)  # shown date skips the skipped one
    for st in ("PAUSED", "DISMISSED", "ENDED"):
        assert R.project([_active(NETFLIX, {"status": st})], TODAY, 90) == []


def test_unconfirmed_only_when_high_confidence_and_edits_stale_out():
    med = R.apply_prefs(detect(NETFLIX[:3])[0], None)
    assert R.project([med], TODAY, 90) == []  # MEDIUM + unconfirmed: not projected
    high = R.apply_prefs(detect(NETFLIX + [tx("Netflix", 649, date(2026, 5, 12))])[0], None)
    assert high["confidence"] == "HIGH" and R.project([high], TODAY, 40)
    p = _active(NETFLIX, {"next_date": "2026-10-20", "expected_amount": 700})
    assert p["next_date"] == date(2026, 10, 20) and p["expected_amount"] == 700
    stale = _active(NETFLIX, {"next_date": "2026-08-01"})  # older than last payment -> ignored
    assert stale["next_date"] == date(2026, 10, 12)


def test_generic_merchants_never_grouped():
    rows = [tx("Unknown", 500, date(2026, m, 5)) for m in (6, 7, 8, 9)]
    rows += [tx("Bank Transfer", 379, date(2026, m, 6)) for m in (6, 7, 8, 9)]
    assert detect(rows) == []


def test_month_end_clamping():
    assert R.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert R.add_months(date(2026, 11, 30), 3) == date(2027, 2, 28)
