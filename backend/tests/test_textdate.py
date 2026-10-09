"""Run: pytest --noconftest tests/test_textdate.py"""
import os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1"); os.environ.setdefault("DB_NAME", "t")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "x" * 43 + "=")
import server

NOW = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)


def day(text):
    d = server.parse_text_date(text, NOW)
    return d and d.date().isoformat()


def test_common_indian_formats():
    assert day("Rs 499 debited on 30-04-26 to X") == "2026-04-30"
    assert day("Rs 499 debited on 30/04/2026") == "2026-04-30"
    assert day("debited 30-Apr-26 ref 1") == "2026-04-30"
    assert day("debited on 30-APR-2026.") == "2026-04-30"
    assert day("credited 5-9-26") == "2026-09-05"


def test_future_and_invalid_dates_are_ignored():
    assert day("EMI due on 05-12-26, thanks") is None            # a due date, not the transaction
    assert day("due 05-12-26. paid on 02-10-26") == "2026-10-02"  # skips the future one
    assert day("on 31-02-26") is None and day("code 12-34-56") is None
    assert day("no date here, Rs 100 debited") is None
    assert day("on 01-01-19") is None                            # older than ~3 years


def test_noon_india_time_so_day_is_stable_across_zones():
    d = server.parse_text_date("on 30-04-26", NOW)
    assert d.hour == 6 and d.minute == 30  # 12:00 IST
