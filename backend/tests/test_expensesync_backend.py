"""ExpenseSync backend tests — auth, ingest, dedup, transactions, dashboard."""
import pytest
import requests
from datetime import datetime, timezone

from conftest import BASE_URL, TEST_TOKEN, TEST_USER_ID


# ---------------- Health ----------------
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------------- Auth ----------------
class TestAuth:
    def test_me_valid(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["user_id"] == TEST_USER_ID
        assert "_id" not in body["user"]

    def test_me_missing(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_invalid(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401

    def test_google_auth_invalid_token(self, api):
        r = api.post(f"{BASE_URL}/api/auth/google", json={"id_token": "invalid-token-xyz"})
        assert r.status_code == 401

    def test_logout_and_reseed(self, api, mongo_db):
        # Use throwaway token so we don't kill the shared one
        throwaway = "throwaway-token-abc"
        mongo_db.user_sessions.update_one(
            {"session_token": throwaway},
            {"$set": {
                "session_token": throwaway,
                "user_id": TEST_USER_ID,
                "expires_at": datetime.now(timezone.utc).replace(year=2099),
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        # Confirm it works
        r = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {throwaway}"})
        assert r.status_code == 200
        # Logout
        r = api.post(f"{BASE_URL}/api/auth/logout", headers={"Authorization": f"Bearer {throwaway}"})
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # Should now be invalid
        r = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {throwaway}"})
        assert r.status_code == 401


# ---------------- Auth enforcement on protected endpoints ----------------
class TestAuthEnforcement:
    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/transactions"),
        ("GET", "/api/dashboard"),
        ("POST", "/api/messages/ingest"),
        ("POST", "/api/messages/seed-sample"),
    ])
    def test_no_auth_returns_401(self, api, method, path):
        r = api.request(method, f"{BASE_URL}{path}", json={"items": []} if method == "POST" else None)
        assert r.status_code == 401, f"{method} {path} => {r.status_code}"

    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/transactions"),
        ("GET", "/api/dashboard"),
        ("POST", "/api/messages/seed-sample"),
    ])
    def test_bad_bearer_returns_401(self, api, method, path):
        headers = {"Authorization": "Bearer garbage-token-999", "Content-Type": "application/json"}
        r = api.request(method, f"{BASE_URL}{path}", headers=headers,
                        json={"items": []} if method == "POST" else None)
        assert r.status_code == 401


# ---------------- Seed sample ----------------
class TestSeedSample:
    def test_seed_produces_expected_counts(self, api, auth_headers, clean_txns):
        r = api.post(f"{BASE_URL}/api/messages/seed-sample", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        # PRD: ~10 saved + 1 duplicate + 1 skipped
        assert body["skipped"] >= 1, body
        assert body["duplicates"] >= 1, body
        assert body["saved"] >= 8, body
        # No mongo _id leakage
        assert "_id" not in str(body)


# ---------------- Ingest / Parser ----------------
class TestIngestParser:
    def test_hdfc_debit_parsed(self, api, auth_headers, clean_txns):
        text = "HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to SWIGGY BANGALORE. UPI Ref 512345678901."
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["saved"] == 1
        # GET to verify persistence
        r2 = api.get(f"{BASE_URL}/api/transactions", headers=auth_headers)
        items = r2.json()["items"]
        assert len(items) == 1
        t = items[0]
        assert t["amount"] == 499.0
        assert t["direction"] == "debit"
        assert "SWIGGY" in t["merchant"].upper()
        assert t["category"] == "Food & Dining"
        assert t["ref_id"] == "512345678901"
        assert t["account"] == "XX1234"
        assert t["parser"] == "regex"

    def test_icici_credit(self, api, auth_headers, clean_txns):
        text = "ICICI Bank Acct XX5678 credited with INR 25000.00 on 10-05-25; UPI:512300110022 from JOHN DOE."
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        body = r.json()
        assert body["saved"] == 1
        items = api.get(f"{BASE_URL}/api/transactions", headers=auth_headers).json()["items"]
        t = items[0]
        assert t["direction"] == "credit"
        assert t["amount"] == 25000.0

    def test_axis_uber_transport(self, api, auth_headers, clean_txns):
        text = "Rs 285.00 debited via UPI to UBER INDIA. Ref no 512456789012 on 11-05-25. -Axis Bank"
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        items = api.get(f"{BASE_URL}/api/transactions", headers=auth_headers).json()["items"]
        assert items[0]["category"] == "Transport"

    def test_amazon_shopping(self, api, auth_headers, clean_txns):
        text = "Your HDFC Credit Card XX9012 was used for Rs.1,299.00 at AMAZON on 09-05-25. Ref: 987654321"
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        items = api.get(f"{BASE_URL}/api/transactions", headers=auth_headers).json()["items"]
        assert items[0]["category"] == "Shopping"
        assert items[0]["amount"] == 1299.00

    def test_promotional_skipped(self, api, auth_headers, clean_txns):
        text = "Get 50% cashback up to Rs.500 on your next purchase. T&C apply. -Paytm"
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        body = r.json()
        assert body["skipped"] == 1
        assert body["saved"] == 0

    def test_failed_payment_notification_skipped(self, api, auth_headers, clean_txns):
        text = ("Hi, Payment of Rs. 199.0 has failed for your Airtel Mobile 7676229027. "
                "Any amount, if debited will be refunded to your source account within a day.")
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        body = r.json()
        assert body["skipped"] == 1
        assert body["saved"] == 0

    def test_self_labeled_spam_skipped(self, api, auth_headers, clean_txns):
        text = ("Airtel Warning: SPAM | TradeConfirmation Account:7676229027 Received: Rs.10301 "
                "Days Position-Dtd:7/14,2026 FA BAL Bal:Rs.31124. Click to view: bit.ly/4vtNxX8?27 TRADFLOW")
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        body = r.json()
        assert body["skipped"] == 1
        assert body["saved"] == 0

    def test_past_failed_attempt_that_now_succeeded_not_skipped(self, api, auth_headers, clean_txns):
        text = ("Rs.500 debited to Merchant XYZ on 12-05-25. Note: previous failed attempt "
                "succeeded now. Ref 512345678901. -HDFC")
        r = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                     json={"items": [{"source": "sms", "text": text}]})
        assert r.status_code == 200
        body = r.json()
        assert body["saved"] == 1
        assert body["skipped"] == 0


# ---------------- Deduplication ----------------
class TestDedup:
    def test_dedup_by_ref_id(self, api, auth_headers, clean_txns):
        text = "Rs.499.00 debited to SWIGGY on 12-05-25. UPI Ref 512345678901. -HDFC"
        r1 = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                      json={"items": [{"source": "sms", "text": text}]})
        assert r1.json()["saved"] == 1
        r2 = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                      json={"items": [{"source": "sms", "text": text}]})
        assert r2.status_code == 200
        assert r2.json()["duplicates"] == 1, r2.json()

    def test_dedup_by_amount_merchant_date(self, api, auth_headers, clean_txns):
        t1 = "HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to SWIGGY BANGALORE. UPI Ref AAA111222333."
        t2 = "Rs.499.00 spent on HDFC Card XX1234 at SWIGGY on 12-05-25. Ref BBB999888777."
        # Different ref_ids, same amount / merchant prefix / same date
        r1 = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                      json={"items": [{"source": "sms", "text": t1}]})
        assert r1.json()["saved"] == 1
        r2 = api.post(f"{BASE_URL}/api/messages/ingest", headers=auth_headers,
                      json={"items": [{"source": "sms", "text": t2}]})
        body = r2.json()
        assert body["duplicates"] == 1, body


# ---------------- Transactions CRUD & filters ----------------
class TestTransactionsCRUD:
    @pytest.fixture
    def seeded(self, api, auth_headers, clean_txns):
        r = api.post(f"{BASE_URL}/api/messages/seed-sample", headers=auth_headers)
        assert r.status_code == 200
        return api.get(f"{BASE_URL}/api/transactions", headers=auth_headers).json()["items"]

    def test_list_no_mongo_id(self, seeded):
        for t in seeded:
            assert "_id" not in t

    def test_filter_by_category(self, api, auth_headers, seeded):
        r = api.get(f"{BASE_URL}/api/transactions?category=Food%20%26%20Dining", headers=auth_headers)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        for t in items:
            assert t["category"] == "Food & Dining"

    def test_filter_by_source(self, api, auth_headers, seeded):
        r = api.get(f"{BASE_URL}/api/transactions?source=email", headers=auth_headers)
        assert r.status_code == 200
        for t in r.json()["items"]:
            assert t["source"] == "email"

    def test_include_duplicates_false(self, api, auth_headers, seeded):
        r_all = api.get(f"{BASE_URL}/api/transactions", headers=auth_headers)
        r_no = api.get(f"{BASE_URL}/api/transactions?include_duplicates=false", headers=auth_headers)
        assert r_all.status_code == 200 and r_no.status_code == 200
        assert len(r_no.json()["items"]) < len(r_all.json()["items"])
        for t in r_no.json()["items"]:
            assert t["is_duplicate"] is False

    def test_get_single_has_raw_text(self, api, auth_headers, seeded):
        tid = seeded[0]["id"]
        r = api.get(f"{BASE_URL}/api/transactions/{tid}", headers=auth_headers)
        assert r.status_code == 200
        t = r.json()
        assert t["id"] == tid
        assert "raw_text" in t and len(t["raw_text"]) > 0
        assert "_id" not in t

    def test_get_single_404(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/transactions/does-not-exist", headers=auth_headers)
        assert r.status_code == 404

    def test_patch_category_and_duplicate(self, api, auth_headers, seeded):
        tid = seeded[0]["id"]
        r = api.patch(f"{BASE_URL}/api/transactions/{tid}", headers=auth_headers,
                      json={"category": "Custom", "is_duplicate": True})
        assert r.status_code == 200, r.text
        # Verify persistence via GET
        r2 = api.get(f"{BASE_URL}/api/transactions/{tid}", headers=auth_headers)
        t = r2.json()
        assert t["category"] == "Custom"
        assert t["is_duplicate"] is True

    def test_delete_txn(self, api, auth_headers, seeded):
        tid = seeded[-1]["id"]
        r = api.delete(f"{BASE_URL}/api/transactions/{tid}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json().get("deleted") == 1
        # Verify gone
        r2 = api.get(f"{BASE_URL}/api/transactions/{tid}", headers=auth_headers)
        assert r2.status_code == 404


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_dashboard_shape_and_exclusions(self, api, auth_headers, clean_txns):
        # Seed data
        r = api.post(f"{BASE_URL}/api/messages/seed-sample", headers=auth_headers)
        assert r.status_code == 200
        d = api.get(f"{BASE_URL}/api/dashboard", headers=auth_headers)
        assert d.status_code == 200, d.text
        body = d.json()
        for key in ("month_spend", "month_income", "by_category", "duplicate_count", "recent", "total_transactions"):
            assert key in body, f"missing {key}"
        # by_category sorted desc
        cats = [c["amount"] for c in body["by_category"]]
        assert cats == sorted(cats, reverse=True)
        # recent limited to 5
        assert len(body["recent"]) <= 5
        # duplicates excluded from month_spend: sum of by_category amounts must equal month_spend
        assert round(sum(c["amount"] for c in body["by_category"]), 2) == body["month_spend"]
        # No mongo _id key at top-level or in recent items
        assert "_id" not in body
        for r in body["recent"]:
            assert "_id" not in r
        assert body["duplicate_count"] >= 1
