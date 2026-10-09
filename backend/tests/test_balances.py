"""Pure tests for balances.py and the balance reader. Run: pytest --noconftest tests/test_balances.py"""
import os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import balances as B


def row(day, direction, amount, bal=None):
    return {"txn_date": datetime(2026, 10, day, 10, tzinfo=timezone.utc), "direction": direction, "amount": amount, "balance_after": bal}


def test_no_balance_ever_reported():
    assert B.running_balance([row(1, "credit", 100000), row(2, "debit", 500)]) is None


def test_anchor_alone_is_exact():
    r = B.running_balance([row(1, "credit", 100000, 100000.0)])
    assert r["balance"] == 100000.0 and r["adjusted"] == 0 and r["estimated"] is False


def test_later_transactions_without_balance_roll_forward():
    r = B.running_balance([row(1, "credit", 100000, 100000.0), row(2, "debit", 1500), row(3, "debit", 499), row(4, "credit", 250)])
    assert r["balance"] == 100000 - 1500 - 499 + 250
    assert r["adjusted"] == 3 and r["estimated"] is True


def test_latest_reported_balance_wins_and_older_ones_are_ignored():
    rows = [row(1, "credit", 100000, 100000.0), row(2, "debit", 1500), row(5, "debit", 200, 98000.0), row(6, "debit", 100)]
    assert B.running_balance(rows)["balance"] == 97900.0


def test_same_day_transactions_not_double_counted():
    rows = [row(2, "debit", 300, 9700.0), row(2, "debit", 50)]  # same day: may already be inside 9700
    r = B.running_balance(rows)
    assert r["balance"] == 9700.0 and r["estimated"] is False


def test_balance_reader_handles_unformatted_and_grouped_numbers():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:1"); os.environ.setdefault("DB_NAME", "t")
    os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "x" * 43 + "=")
    import server
    now = datetime.now(timezone.utc)
    cases = {
        "A/c XX1234 credited with Rs.100000.00 on 01-10-26. Avl Bal Rs.126434.00 -PNB": 126434.0,
        "A/c XX1234 debited Rs.1500.00 on 02-10-26. Avl Bal INR 124934.50 -PNB": 124934.5,
        "Rs 25,000.00 credited to a/c XX1234. Avl Bal Rs 1,26,434.00 -HDFC": 126434.0,
        "Rs 2500 debited from a/c XX1234. Avl Bal: Rs.126,434.00": 126434.0,
        "Your a/c XX1234 is credited by Rs.100000/- on 01-10-26. Bal Rs.126434/-": 126434.0,
    }
    for text, want in cases.items():
        assert server.regex_parse(text, "sms", now)["balance_after"] == want, text
