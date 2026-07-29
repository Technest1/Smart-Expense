"""
Security audit fix verification tests.

Covers:
- SEC-001: ingest batch cap (413 on >50), text-per-item cap (4000 chars truncated),
  regex-only parsing happy path
- SEC-002: CORS response must NOT set Access-Control-Allow-Credentials: true
- HARDENING: GET /api/transactions?limit=99999 clamped to MAX_TXN_LIST_LIMIT=500
- REGRESSION: seed-sample → dashboard → transactions list → PATCH category flow
- REGRESSION: sprint-2 budgets + analytics endpoints still function
- REGRESSION: auth enforced (401 with no/bad bearer)
"""
import os
import re
import time
from pathlib import Path
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
SERVER_PY = (Path(__file__).parent.parent / "server.py").read_text()


# ---------------------------------------------------------------
# SEC-001: /api/messages/ingest batch size cap (413 for >50)
# ---------------------------------------------------------------
class TestIngestBatchCap:
    def _payload(self, n):
        return {
            "items": [
                {"source": "sms",
                 "text": "HDFC Bank: Rs.10.00 debited from a/c XX1111 to TEST_MERCHANT_%d. Ref TR%d" % (i, i)}
                for i in range(n)
            ]
        }

    def test_over_50_items_returns_413(self, auth_headers, clean_txns):
        r = requests.post(f"{BASE_URL}/api/messages/ingest",
                          json=self._payload(51), headers=auth_headers)
        assert r.status_code == 413, f"Expected 413 for >50 items, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "50" in detail or "max" in detail.lower(), \
            f"413 detail should mention max/50, got: {detail}"

    def test_exactly_50_items_succeeds(self, auth_headers, clean_txns):
        r = requests.post(f"{BASE_URL}/api/messages/ingest",
                          json=self._payload(50), headers=auth_headers)
        assert r.status_code == 200, f"Expected 200 for exactly 50 items, got {r.status_code}: {r.text}"
        body = r.json()
        # saved + duplicates + skipped should equal 50
        total = body["saved"] + body["duplicates"] + body["skipped"]
        assert total == 50, f"result totals should equal 50, got {total} (body={body})"


# ---------------------------------------------------------------
# SEC-001: individual text length cap (raw_text stored <= 4000)
# ---------------------------------------------------------------
class TestIngestTextCap:
    def test_long_text_is_truncated_to_4000_chars(self, auth_headers, clean_txns, mongo_db):
        # Valid parseable HDFC debit SMS prefix + huge junk tail
        prefix = ("HDFC Bank: Rs.123.00 debited from a/c XX9999 on 12-05-25 to "
                  "TESTMERCHANT_TRUNC. UPI Ref TRUNC12345678. ")
        junk = "X" * 6000
        text = prefix + junk
        payload = {"items": [{"source": "sms", "text": text}]}
        r = requests.post(f"{BASE_URL}/api/messages/ingest",
                          json=payload, headers=auth_headers)
        assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["saved"] + body["duplicates"] == 1, \
            f"Expected 1 txn stored (saved or dup), got {body}"

        # Verify raw_text length in Mongo <= 4000
        doc = mongo_db.transactions.find_one({"user_id": "user_test000001"})
        assert doc is not None, "no transaction persisted"
        assert len(doc["raw_text"]) <= 4000, \
            f"raw_text should be capped at 4000 chars, got {len(doc['raw_text'])}"
        # And it should start with our valid prefix (truncation from tail)
        assert doc["raw_text"].startswith(prefix[:100]), \
            "raw_text should start with the original valid prefix (truncation from tail)"


# ---------------------------------------------------------------
# SEC-001: regex-only parsing happy path (no external AI dependency)
# ---------------------------------------------------------------
class TestRegexParseHappyPath:
    def test_happy_path_ingest_parses_via_regex(self, auth_headers, clean_txns):
        payload = {"items": [
            {"source": "sms",
             "text": "HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to "
                     "SWIGGY BANGALORE. UPI Ref 512345678901."}
        ]}
        r = requests.post(f"{BASE_URL}/api/messages/ingest",
                          json=payload, headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["saved"] == 1 and body["skipped"] == 0, \
            f"regex should have parsed the SMS: {body}"


# ---------------------------------------------------------------
# SEC-002: CORS should NOT include Access-Control-Allow-Credentials
# ---------------------------------------------------------------
class TestCORSNoCredentials:
    def test_preflight_no_allow_credentials_header(self):
        r = requests.options(
            f"{BASE_URL}/api/transactions",
            headers={
                "Origin": "https://random-origin.example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        # We accept anything reasonable, but the credentials header must NOT be true
        cred = r.headers.get("Access-Control-Allow-Credentials", "")
        assert cred.lower() != "true", \
            f"CORS Allow-Credentials should NOT be true, got: {cred!r}"

    def test_simple_get_no_allow_credentials_header(self):
        r = requests.get(
            f"{BASE_URL}/api/",
            headers={"Origin": "https://random-origin.example.com"},
        )
        cred = r.headers.get("Access-Control-Allow-Credentials", "")
        assert cred.lower() != "true", \
            f"CORS Allow-Credentials should NOT be true, got: {cred!r}"

    def test_code_uses_allow_credentials_false(self):
        assert re.search(r"allow_credentials\s*=\s*False", SERVER_PY), \
            "CORSMiddleware should be configured with allow_credentials=False"


# ---------------------------------------------------------------
# HARDENING: /api/transactions?limit=99999 clamped to 500
# ---------------------------------------------------------------
class TestTxnListLimitClamp:
    def test_huge_limit_is_clamped(self, auth_headers, clean_txns):
        # Seed some txns via seed-sample so response has items
        r_seed = requests.post(f"{BASE_URL}/api/messages/seed-sample", headers=auth_headers)
        assert r_seed.status_code == 200, r_seed.text

        r = requests.get(f"{BASE_URL}/api/transactions?limit=99999", headers=auth_headers)
        assert r.status_code == 200, f"expected 200 with clamped limit, got {r.status_code}: {r.text}"
        items = r.json()["items"]
        assert len(items) <= 500, f"items count must be <=500, got {len(items)}"
        # Sanity: at least one seeded txn
        assert len(items) >= 1

    def test_constant_max_txn_list_limit_500(self):
        assert "MAX_TXN_LIST_LIMIT = 500" in SERVER_PY, "MAX_TXN_LIST_LIMIT=500 missing"


# ---------------------------------------------------------------
# REGRESSION: sprint-1 happy path
# ---------------------------------------------------------------
class TestSprint1Regression:
    def test_seed_dashboard_list_patch(self, auth_headers, clean_txns):
        r_seed = requests.post(f"{BASE_URL}/api/messages/seed-sample", headers=auth_headers)
        assert r_seed.status_code == 200, r_seed.text
        body = r_seed.json()
        assert body["saved"] >= 1

        # Dashboard
        r_dash = requests.get(f"{BASE_URL}/api/dashboard", headers=auth_headers)
        assert r_dash.status_code == 200
        dash = r_dash.json()
        for key in ("month_spend", "month_income", "by_category",
                    "duplicate_count", "recent", "total_transactions",
                    "budgets", "recurring_count"):
            assert key in dash, f"dashboard missing key: {key}"

        # List
        r_list = requests.get(f"{BASE_URL}/api/transactions?limit=100", headers=auth_headers)
        assert r_list.status_code == 200
        items = r_list.json()["items"]
        assert len(items) >= 1

        # PATCH category on first txn
        txn = items[0]
        original_cat = txn["category"]
        new_cat = "Health" if original_cat != "Health" else "Transport"
        r_patch = requests.patch(
            f"{BASE_URL}/api/transactions/{txn['id']}",
            json={"category": new_cat}, headers=auth_headers,
        )
        assert r_patch.status_code == 200, r_patch.text
        assert r_patch.json()["category"] == new_cat

        # Verify persistence
        r_get = requests.get(f"{BASE_URL}/api/transactions/{txn['id']}", headers=auth_headers)
        assert r_get.status_code == 200
        assert r_get.json()["category"] == new_cat


# ---------------------------------------------------------------
# REGRESSION: sprint-2 endpoints still work
# ---------------------------------------------------------------
class TestSprint2Regression:
    def test_budgets_crud_and_analytics(self, auth_headers, clean_txns, mongo_db):
        # Wipe budgets first for isolation
        mongo_db.budgets.delete_many({"user_id": "user_test000001"})

        # Create
        r_cr = requests.post(
            f"{BASE_URL}/api/budgets",
            json={"category": "Food & Dining", "monthly_limit": 5000},
            headers=auth_headers,
        )
        assert r_cr.status_code == 200, r_cr.text
        bid = r_cr.json()["id"]
        assert r_cr.json()["monthly_limit"] == 5000

        # List
        r_ls = requests.get(f"{BASE_URL}/api/budgets", headers=auth_headers)
        assert r_ls.status_code == 200
        assert any(b["id"] == bid for b in r_ls.json()["items"])

        # Analytics: monthly-trend
        r_mt = requests.get(f"{BASE_URL}/api/analytics/monthly-trend?months=6",
                            headers=auth_headers)
        assert r_mt.status_code == 200
        series = r_mt.json()["series"]
        assert len(series) == 6
        for pt in series:
            for k in ("month", "label", "amount"):
                assert k in pt

        # Analytics: recurring
        r_rc = requests.get(f"{BASE_URL}/api/analytics/recurring",
                            headers=auth_headers)
        assert r_rc.status_code == 200
        rc = r_rc.json()
        assert "items" in rc and "total_monthly" in rc

        # Delete budget
        r_del = requests.delete(f"{BASE_URL}/api/budgets/{bid}", headers=auth_headers)
        assert r_del.status_code == 200
        assert r_del.json()["deleted"] == 1


# ---------------------------------------------------------------
# REGRESSION: Auth enforcement
# ---------------------------------------------------------------
class TestAuthEnforcement:
    @pytest.mark.parametrize("path,method", [
        ("/api/auth/me", "GET"),
        ("/api/dashboard", "GET"),
        ("/api/transactions", "GET"),
        ("/api/budgets", "GET"),
        ("/api/analytics/monthly-trend", "GET"),
        ("/api/analytics/recurring", "GET"),
        ("/api/messages/ingest", "POST"),
        ("/api/messages/seed-sample", "POST"),
    ])
    def test_missing_bearer_returns_401(self, path, method):
        fn = getattr(requests, method.lower())
        kwargs = {}
        if method == "POST":
            kwargs["json"] = {"items": []} if "ingest" in path else {}
        r = fn(f"{BASE_URL}{path}", **kwargs)
        assert r.status_code == 401, f"{method} {path} without bearer -> {r.status_code}"

    @pytest.mark.parametrize("path", [
        "/api/auth/me",
        "/api/dashboard",
        "/api/transactions",
        "/api/budgets",
    ])
    def test_bad_bearer_returns_401(self, path):
        r = requests.get(f"{BASE_URL}{path}",
                         headers={"Authorization": "Bearer totally-not-valid-xyz"})
        assert r.status_code == 401
