"""Sprint 3 backend tests:
- Dashboard date-range filters (today/week/month/all/custom + validation)
- Budgets populated only when range overlaps current month
- month_spend/by_category only debit + non-duplicate + within window
- GET /api/accounts/balances (last-known balance per account)
- GET /api/analytics/by-merchant (sorted, capped, debit-only)
- Regex parser: balance_after extraction + tightened merchant + email fallback
- Auth 401 on new endpoints
- No _id in responses
"""
import os
import uuid
import pytest
import requests
from urllib.parse import quote
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
# Use a DIFFERENT user_id/token so this file's data-wiping fixtures never collide
# with test_expensesync_backend.py / test_security_audit_fixes.py running in parallel
# via xdist. Session/user is seeded by _seed_sprint3_user autouse fixture below.
TEST_USER_ID = "user_sprint3_test"
TEST_TOKEN = "test-token-sprint3-xyz"


@pytest.fixture(scope="module", autouse=True)
def _seed_sprint3_user(mongo_db):
    mongo_db.users.update_one(
        {"user_id": TEST_USER_ID},
        {"$set": {"user_id": TEST_USER_ID, "email": "sprint3@x.com", "name": "Sprint3 User",
                  "picture": None, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    mongo_db.user_sessions.update_one(
        {"session_token": TEST_TOKEN},
        {"$set": {"session_token": TEST_TOKEN, "user_id": TEST_USER_ID,
                  "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                  "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
    mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})
    yield
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
    mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})
    mongo_db.user_sessions.delete_one({"session_token": TEST_TOKEN})
    mongo_db.users.delete_one({"user_id": TEST_USER_ID})


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}


def _no_underscore_id(obj):
    """Recursively assert no '_id' key exists anywhere."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"Response leaks Mongo _id: {list(obj.keys())}"
        for v in obj.values():
            _no_underscore_id(v)
    elif isinstance(obj, list):
        for i in obj:
            _no_underscore_id(i)


# ---------- helpers to seed txns directly in mongo for deterministic dates ----------
def _mk_txn(user_id, amount, direction, merchant, category, txn_date,
            account=None, ref_id=None, balance_after=None, is_duplicate=False,
            raw_text=""):
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "amount": amount,
        "currency": "INR",
        "direction": direction,
        "merchant": merchant,
        "category": category,
        "txn_date": txn_date,
        "source": "sms",
        "account": account,
        "ref_id": ref_id,
        "balance_after": balance_after,
        "raw_text": raw_text,
        "parser": "regex",
        "is_duplicate": is_duplicate,
        "duplicate_of": None,
        "created_at": datetime.now(timezone.utc),
    }


@pytest.fixture
def seed_range_txns(mongo_db):
    """Seed txns across today / week / this-month / last-month / two-months-ago."""
    now = datetime.now(timezone.utc)
    # Use a time guaranteed to be in the past (before "now") AND still today (post-midnight)
    minutes_since_midnight = now.hour * 60 + now.minute
    delta = min(60, max(1, minutes_since_midnight - 1))
    today = now - timedelta(minutes=delta)
    yesterday = today - timedelta(days=1)
    three_days_ago = today - timedelta(days=3)
    this_month_early = now.replace(day=2, hour=10, minute=0, second=0, microsecond=0) \
        if now.day >= 2 else today  # early in month
    last_month = (now.replace(day=1) - timedelta(days=5)).replace(hour=12, minute=0, second=0, microsecond=0)
    two_months_ago = (now.replace(day=1) - timedelta(days=40)).replace(hour=12, minute=0, second=0, microsecond=0)

    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
    docs = [
        # today - debit
        _mk_txn(TEST_USER_ID, 100.0, "debit", "SWIGGY", "Food & Dining", today,
                account="XX1234", balance_after=5000.0),
        # yesterday (in "week" and "month") - debit
        _mk_txn(TEST_USER_ID, 200.0, "debit", "UBER INDIA", "Transport", yesterday,
                account="XX1234", balance_after=4800.0),
        # 3 days ago (in "week" and "month") - debit
        _mk_txn(TEST_USER_ID, 300.0, "debit", "AMAZON", "Shopping", three_days_ago,
                account="XX9012", balance_after=15000.0),
        # this-month-early credit (income, not spend)
        _mk_txn(TEST_USER_ID, 5000.0, "credit", "SALARY", "Transfers", this_month_early,
                account="XX5678", balance_after=25000.0),
        # last-month debit (NOT in month/week/today; is in "all")
        _mk_txn(TEST_USER_ID, 999.0, "debit", "NETFLIX", "Entertainment", last_month,
                account="XX4432"),
        # two-months-ago debit (only in "all")
        _mk_txn(TEST_USER_ID, 750.0, "debit", "AIRTEL", "Bills & Utilities", two_months_ago,
                account="XX3344", balance_after=8000.0),
        # duplicate - should be excluded from every window computation
        _mk_txn(TEST_USER_ID, 100.0, "debit", "SWIGGY", "Food & Dining", today,
                account="XX1234", is_duplicate=True),
    ]
    mongo_db.transactions.insert_many(docs)
    yield {
        "today": today, "yesterday": yesterday, "three_days_ago": three_days_ago,
        "last_month": last_month, "two_months_ago": two_months_ago,
    }
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})


# ================= DASHBOARD DATE RANGES =================
class TestSprint3All:
    """All sprint 3 tests in one class so `--dist loadscope` pins them to
    a single xdist worker (avoids cross-class races on the shared user)."""

    def test_range_today(self, api, auth_headers, seed_range_txns):
        now = datetime.now(timezone.utc)
        r = api.get(f"{BASE_URL}/api/dashboard?range=today", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert data["range"]["key"] == "today"
        assert data["range"]["label"] == "Today"
        # start = midnight today
        start = datetime.fromisoformat(data["range"]["start"])
        assert start.hour == 0 and start.minute == 0 and start.date() == now.date()
        # Only today's debit (100) counts
        assert data["month_spend"] == 100.0
        # Only 1 debit today (credit is dated earlier in the month; dup excluded)
        assert data["total_transactions"] == 1

    def test_range_week(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/dashboard?range=week", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["range"]["label"] == "Last 7 days"
        # today + yesterday + 3 days ago debits = 100 + 200 + 300
        assert data["month_spend"] == 600.0

    def test_range_month_default(self, api, auth_headers, seed_range_txns):
        # No range param -> defaults to "month"
        r = api.get(f"{BASE_URL}/api/dashboard", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["range"]["key"] == "month"
        assert data["range"]["label"] == "This month"
        start = datetime.fromisoformat(data["range"]["start"])
        assert start.day == 1

    def test_range_all(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/dashboard?range=all", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["range"]["label"] == "All time"
        start = datetime.fromisoformat(data["range"]["start"])
        assert start.year == 2000 and start.month == 1 and start.day == 1
        # All debits: 100 + 200 + 300 + 999 + 750 = 2349 (excluding dup and credit)
        assert data["month_spend"] == 2349.0

    def test_range_custom_valid(self, api, auth_headers, seed_range_txns):
        r = api.get(
            f"{BASE_URL}/api/dashboard?range=custom"
            f"&start=2026-06-01T00:00:00&end=2026-06-30T23:59:59",
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["range"]["label"] == "Custom"

    def test_range_custom_no_params_falls_back(self, api, auth_headers):
        """range=custom with no start/end should NOT 400 (falls back per _resolve_date_range)."""
        r = api.get(f"{BASE_URL}/api/dashboard?range=custom", headers=auth_headers)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_range_custom_bogus_start_400(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/dashboard?range=custom&start=bogus",
                    headers=auth_headers)
        assert r.status_code == 400

    def test_range_custom_end_before_start_400(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/dashboard?range=custom"
            f"&start=2026-06-30T00:00:00&end=2026-06-01T00:00:00",
            headers=auth_headers,
        )
        assert r.status_code == 400


    def test_budgets_populated_for_current_month(self, api, auth_headers, mongo_db, seed_range_txns):
        mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Food & Dining", "monthly_limit": 1000.0})
        try:
            r = api.get(f"{BASE_URL}/api/dashboard?range=month", headers=auth_headers)
            assert r.status_code == 200
            data = r.json()
            assert isinstance(data["budgets"], list) and len(data["budgets"]) >= 1
            b = next(x for x in data["budgets"] if x["category"] == "Food & Dining")
            # SWIGGY today = 100 => spent==100
            assert b["spent"] == 100.0

            # today range also overlaps current month => still populated
            r2 = api.get(f"{BASE_URL}/api/dashboard?range=today", headers=auth_headers)
            assert len(r2.json()["budgets"]) >= 1
        finally:
            mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})

    def test_budgets_empty_for_past_custom_range(self, api, auth_headers, mongo_db, seed_range_txns):
        mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Food & Dining", "monthly_limit": 1000.0})
        try:
            # Pick a window entirely in the past (last month)
            lm = seed_range_txns["last_month"]
            s = lm.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            e = s + timedelta(days=25)
            # strip tz to avoid '+' being decoded as space in query string
            start_s = quote(s.replace(tzinfo=None).isoformat())
            end_s = quote(e.replace(tzinfo=None).isoformat())
            r = api.get(
                f"{BASE_URL}/api/dashboard?range=custom&start={start_s}&end={end_s}",
                headers=auth_headers,
            )
            assert r.status_code == 200
            assert r.json()["budgets"] == []
        finally:
            mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})


    def test_month_spend_and_by_category(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/dashboard?range=month", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        # This-month debits: SWIGGY 100 + UBER 200 + AMAZON 300 = 600 (dup excluded, credit excluded)
        assert data["month_spend"] == 600.0
        assert data["month_income"] == 5000.0  # salary credit
        by_cat = {c["category"]: c["amount"] for c in data["by_category"]}
        assert by_cat.get("Food & Dining") == 100.0
        assert by_cat.get("Transport") == 200.0
        assert by_cat.get("Shopping") == 300.0
        # Transfers (credit) should NOT be in by_category (debit-only)
        assert "Transfers" not in by_cat


# ================= ACCOUNTS BALANCES =================
    def test_latest_per_account_and_total(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/accounts/balances", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert "items" in data and "total" in data
        accounts = {i["account"]: i for i in data["items"]}
        # XX1234 latest txn today has balance 5000 (dup excluded because is_duplicate=True filtered)
        assert accounts["XX1234"]["balance"] == 5000.0
        assert accounts["XX9012"]["balance"] == 15000.0
        assert accounts["XX5678"]["balance"] == 25000.0
        # XX4432 had NO balance_after -> excluded
        assert "XX4432" not in accounts
        # AIRTEL / XX3344 last balance = 8000
        assert accounts["XX3344"]["balance"] == 8000.0
        expected_total = round(sum(x["balance"] for x in data["items"]), 2)
        assert data["total"] == expected_total
        # required shape
        for i in data["items"]:
            assert set(i.keys()) >= {"account", "balance", "as_of"}


# ================= ANALYTICS BY-MERCHANT =================
    def test_all_range_sorted_and_limited(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/analytics/by-merchant?range=all&limit=5",
                    headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert len(data["items"]) <= 5
        totals = [i["total"] for i in data["items"]]
        assert totals == sorted(totals, reverse=True)
        for i in data["items"]:
            assert set(i.keys()) >= {"merchant", "category", "total", "count", "avg"}
        # NETFLIX (999) should be present in "all" but not in month
        merchants = {i["merchant"].upper() for i in data["items"]}
        assert any("NETFLIX" in m for m in merchants)

    def test_default_range_is_month(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/analytics/by-merchant", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["range"]["key"] == "month"
        assert data["range"]["label"] == "This month"
        merchants = {i["merchant"].upper() for i in data["items"]}
        # NETFLIX (last month) should NOT appear in default (month) range
        assert not any("NETFLIX" in m for m in merchants)
        # Credit SALARY should NOT appear (debit only)
        assert not any("SALARY" in m for m in merchants)

    def test_limit_clamped_to_100(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/analytics/by-merchant?range=all&limit=999",
                    headers=auth_headers)
        assert r.status_code == 200  # should not error; internally clamped


# ================= REGEX PARSER =================
    def test_balance_after_extraction(self, mongo_db, api, auth_headers):
        mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
        cases = [
            ("HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to SWIGGY. Avl Bal: Rs.24,501.50", 24501.50),
            ("ICICI credited INR 25000.00 to a/c XX5678. Available Balance INR 41,234.55", 41234.55),
            ("Rs 285.00 debited via UPI to UBER. Bal: Rs 12,455.00", 12455.00),
        ]
        for text, expected in cases:
            r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                         json={"items": [{"source": "sms", "text": text}]})
            assert r.status_code == 200

        txns = list(mongo_db.transactions.find({"user_id": TEST_USER_ID}))
        got = sorted([t.get("balance_after") for t in txns if t.get("balance_after") is not None])
        assert 24501.50 in got
        assert 41234.55 in got
        assert 12455.00 in got
        mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})

    def test_tightened_merchant_regex(self, mongo_db, api, auth_headers):
        mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})

        # Case 1: "for Rs.1,299.00 at AMAZON" -> merchant should be AMAZON (not "Rs.1")
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers, json={
            "items": [{"source": "sms",
                       "text": "Your HDFC Credit Card XX9012 was used for Rs.1,299.00 at AMAZON on 09-05-25. Ref: 987654321"}]
        })
        assert r.status_code == 200
        t1 = mongo_db.transactions.find_one({"user_id": TEST_USER_ID, "amount": 1299.0})
        assert t1 is not None, "Amazon txn not saved"
        assert "AMAZON" in t1["merchant"].upper(), f"Expected AMAZON, got '{t1['merchant']}'"
        assert not t1["merchant"].lower().startswith("rs")

        # Case 2: "for AIRTEL POSTPAID BILL" - merchant should contain AIRTEL
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers, json={
            "items": [{"source": "sms",
                       "text": "Rs.899 debited from your account XX3344 for AIRTEL POSTPAID BILL. Ref: AIRT88291."}]
        })
        assert r.status_code == 200
        t2 = mongo_db.transactions.find_one({"user_id": TEST_USER_ID, "amount": 899.0})
        assert t2 is not None
        assert "AIRTEL" in t2["merchant"].upper(), f"Expected AIRTEL in merchant, got '{t2['merchant']}'"

        # Case 3: Netflix email - merchant should NOT be "card ending..."; should use email fallback
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers, json={
            "items": [{"source": "email",
                       "text": "Payment received for Netflix Premium subscription. Amount: INR 649.00 charged to card ending 4432 on 08-05-2025. Reference NTFX20250508."}]
        })
        assert r.status_code == 200
        t3 = mongo_db.transactions.find_one({"user_id": TEST_USER_ID, "amount": 649.0})
        assert t3 is not None, "Netflix txn not saved"
        merchant_lower = t3["merchant"].lower()
        assert "card" not in merchant_lower, f"Merchant leaked 'card ending...': '{t3['merchant']}'"
        assert "netflix" in merchant_lower, f"Expected Netflix, got '{t3['merchant']}'"

        mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})


# ================= AUTH ENFORCEMENT =================
    @pytest.mark.parametrize("path", [
        "/api/accounts/balances",
        "/api/analytics/by-merchant",
        "/api/dashboard?range=today",
        "/api/dashboard?range=week",
        "/api/dashboard?range=custom&start=2026-01-01T00:00:00&end=2026-01-31T00:00:00",
    ])
    def test_401_without_token(self, api, path):
        r = api.get(f"{BASE_URL}{path}")
        assert r.status_code == 401

    @pytest.mark.parametrize("path", [
        "/api/accounts/balances",
        "/api/analytics/by-merchant",
    ])
    def test_401_with_bad_token(self, api, path):
        r = api.get(f"{BASE_URL}{path}", headers={"Authorization": "Bearer nonexistent-xyz"})
        assert r.status_code == 401


# ================= NO _id LEAK =================
    def test_dashboard_no_id(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/dashboard?range=all", headers=auth_headers)
        _no_underscore_id(r.json())

    def test_balances_no_id(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/accounts/balances", headers=auth_headers)
        _no_underscore_id(r.json())

    def test_by_merchant_no_id(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/analytics/by-merchant?range=all", headers=auth_headers)
        _no_underscore_id(r.json())

    def test_transactions_no_id(self, api, auth_headers, seed_range_txns):
        r = api.get(f"{BASE_URL}/api/transactions", headers=auth_headers)
        _no_underscore_id(r.json())


# ================= REGRESSIONS =================
    def test_ingest_batch_cap_413(self, api, auth_headers):
        items = [{"source": "sms", "text": f"Rs.10 debited to TEST{i}"} for i in range(51)]
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": items})
        assert r.status_code == 413

    def test_monthly_trend_still_works(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/analytics/monthly-trend?months=3", headers=auth_headers)
        assert r.status_code == 200
        assert "series" in r.json()
        assert len(r.json()["series"]) == 3

    def test_recurring_still_works(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/analytics/recurring", headers=auth_headers)
        assert r.status_code == 200
        assert "items" in r.json() and "total_monthly" in r.json()

    def test_budgets_crud(self, api, auth_headers, mongo_db):
        mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})
        r = api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                     json={"category": "Shopping", "monthly_limit": 500.0})
        assert r.status_code == 200
        bid = r.json()["id"]
        r2 = api.get(f"{BASE_URL}/api/budgets", headers=auth_headers)
        assert r2.status_code == 200
        assert any(b["id"] == bid for b in r2.json()["items"])
        r3 = api.delete(f"{BASE_URL}/api/budgets/{bid}", headers=auth_headers)
        assert r3.status_code == 200
        mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})

    def test_txn_crud_smoke(self, api, auth_headers, mongo_db):
        mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers, json={
            "items": [{"source": "sms",
                       "text": "Rs.150 debited to STARBUCKS on 12-05-25. Ref STB123456."}]
        })
        assert r.status_code == 200
        rid = r.json()["results"][0]["id"]
        r2 = api.get(f"{BASE_URL}/api/transactions/{rid}", headers=auth_headers)
        assert r2.status_code == 200
        # PATCH
        r3 = api.patch(f"{BASE_URL}/api/transactions/{rid}", headers=auth_headers,
                       json={"category": "Food & Dining"})
        assert r3.status_code == 200
        assert r3.json()["category"] == "Food & Dining"
        # DELETE
        r4 = api.delete(f"{BASE_URL}/api/transactions/{rid}", headers=auth_headers)
        assert r4.status_code == 200
        mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
