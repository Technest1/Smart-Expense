"""Sprint-2 tests: budgets, analytics (monthly-trend, recurring), dashboard new fields."""
import uuid
import pytest
from datetime import datetime, timezone, timedelta

from conftest import BASE_URL, TEST_TOKEN, TEST_USER_ID


# ---------- Helpers ----------
def _clean(mongo_db):
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
    mongo_db.budgets.delete_many({"user_id": TEST_USER_ID})


def _insert_txn(mongo_db, *, merchant, amount, category, days_ago=0,
                direction="debit", is_duplicate=False):
    now = datetime.now(timezone.utc)
    txn_date = now - timedelta(days=days_ago)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": TEST_USER_ID,
        "amount": amount,
        "currency": "INR",
        "direction": direction,
        "merchant": merchant,
        "category": category,
        "txn_date": txn_date,
        "source": "sms",
        "account": None,
        "ref_id": None,
        "raw_text": "",
        "parser": "regex",
        "is_duplicate": is_duplicate,
        "duplicate_of": None,
        "created_at": now,
    }
    mongo_db.transactions.insert_one(doc)
    return doc


@pytest.fixture
def fresh(mongo_db):
    _clean(mongo_db)
    yield mongo_db
    _clean(mongo_db)


# ============ Budgets ============
class TestBudgets:
    # POST create budget
    def test_create_budget(self, api, auth_headers, fresh):
        r = api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                     json={"category": "Food & Dining", "monthly_limit": 5000})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["category"] == "Food & Dining"
        assert body["monthly_limit"] == 5000
        assert "id" in body
        assert "_id" not in body

    # POST idempotent per category (update limit)
    def test_create_budget_idempotent_updates_limit(self, api, auth_headers, fresh):
        r1 = api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                      json={"category": "Transport", "monthly_limit": 1000})
        assert r1.status_code == 200
        id1 = r1.json()["id"]
        r2 = api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                      json={"category": "Transport", "monthly_limit": 2500})
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2["monthly_limit"] == 2500
        # should keep same id (upsert), so only 1 budget for that category
        lst = api.get(f"{BASE_URL}/api/budgets", headers=auth_headers).json()["items"]
        transport = [b for b in lst if b["category"] == "Transport"]
        assert len(transport) == 1
        assert transport[0]["id"] == id1
        assert transport[0]["monthly_limit"] == 2500

    # POST 400 for non-positive limit
    @pytest.mark.parametrize("bad", [0, -10, -0.01])
    def test_create_budget_bad_limit(self, api, auth_headers, fresh, bad):
        r = api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                     json={"category": "Shopping", "monthly_limit": bad})
        assert r.status_code == 400, r.text

    # GET list
    def test_list_budgets(self, api, auth_headers, fresh):
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Food & Dining", "monthly_limit": 5000})
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Transport", "monthly_limit": 2000})
        r = api.get(f"{BASE_URL}/api/budgets", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body
        assert len(body["items"]) == 2
        cats = {b["category"] for b in body["items"]}
        assert cats == {"Food & Dining", "Transport"}
        for b in body["items"]:
            assert "_id" not in b

    # DELETE
    def test_delete_budget(self, api, auth_headers, fresh):
        r = api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                     json={"category": "Health", "monthly_limit": 500})
        bid = r.json()["id"]
        rd = api.delete(f"{BASE_URL}/api/budgets/{bid}", headers=auth_headers)
        assert rd.status_code == 200
        assert rd.json().get("deleted") == 1
        # Verify gone
        lst = api.get(f"{BASE_URL}/api/budgets", headers=auth_headers).json()["items"]
        assert all(b["id"] != bid for b in lst)


# ============ Dashboard new fields ============
class TestDashboardBudgets:
    def test_dashboard_budgets_over_and_near_and_recurring_count(self, api, auth_headers, fresh):
        mongo_db = fresh
        # Current-month debits
        _insert_txn(mongo_db, merchant="Zomato", amount=600, category="Food & Dining", days_ago=1)
        _insert_txn(mongo_db, merchant="Swiggy", amount=500, category="Food & Dining", days_ago=2)
        # duplicate should be excluded from spent
        _insert_txn(mongo_db, merchant="Swiggy Dup", amount=999, category="Food & Dining",
                    days_ago=2, is_duplicate=True)
        _insert_txn(mongo_db, merchant="Uber", amount=200, category="Transport", days_ago=3)

        # Budget where spent (1100) >= limit(1000) -> over_budget
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Food & Dining", "monthly_limit": 1000})
        # Budget where spent(200)/limit(240) = 83.3% -> near_limit
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Transport", "monthly_limit": 240})
        # Budget where spent(0)/limit(1000) = 0% -> neither
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Shopping", "monthly_limit": 1000})

        d = api.get(f"{BASE_URL}/api/dashboard", headers=auth_headers)
        assert d.status_code == 200, d.text
        body = d.json()
        assert "budgets" in body
        assert "recurring_count" in body
        assert isinstance(body["budgets"], list)
        assert len(body["budgets"]) == 3
        by_cat = {b["category"]: b for b in body["budgets"]}

        # Food & Dining: over_budget
        f = by_cat["Food & Dining"]
        assert f["spent"] == 1100.0
        assert f["monthly_limit"] == 1000
        assert f["over_budget"] is True
        assert f["near_limit"] is False
        assert f["pct"] >= 100

        # Transport: near_limit (83.3%)
        t = by_cat["Transport"]
        assert t["spent"] == 200.0
        assert 80.0 <= t["pct"] < 100.0
        assert t["near_limit"] is True
        assert t["over_budget"] is False

        # Shopping: neither
        s = by_cat["Shopping"]
        assert s["spent"] == 0
        assert s["over_budget"] is False
        assert s["near_limit"] is False

        # No mongo _id on any budget row
        for b in body["budgets"]:
            assert "_id" not in b

        # recurring_count is an int
        assert isinstance(body["recurring_count"], int)
        assert body["recurring_count"] >= 0

    def test_dashboard_over_budget_exact_boundary(self, api, auth_headers, fresh):
        """spent == monthly_limit should be over_budget=True (>=)."""
        mongo_db = fresh
        _insert_txn(mongo_db, merchant="M", amount=500, category="Bills & Utilities", days_ago=1)
        api.post(f"{BASE_URL}/api/budgets", headers=auth_headers,
                 json={"category": "Bills & Utilities", "monthly_limit": 500})
        d = api.get(f"{BASE_URL}/api/dashboard", headers=auth_headers).json()
        b = [x for x in d["budgets"] if x["category"] == "Bills & Utilities"][0]
        assert b["over_budget"] is True
        assert b["near_limit"] is False


# ============ Analytics: Monthly Trend ============
class TestMonthlyTrend:
    def test_default_months_6_order_and_shape(self, api, auth_headers, fresh):
        r = api.get(f"{BASE_URL}/api/analytics/monthly-trend?months=6", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "series" in body
        series = body["series"]
        assert len(series) == 6
        # Every entry has month, label, amount
        for row in series:
            assert set(row.keys()) >= {"month", "label", "amount"}
            assert "_id" not in row
        # Order oldest -> newest (month strings YYYY-MM must be strictly increasing)
        months = [row["month"] for row in series]
        assert months == sorted(months), f"not oldest->newest: {months}"
        # Last entry is the current month
        now = datetime.now(timezone.utc)
        assert series[-1]["month"] == now.strftime("%Y-%m")

    def test_missing_months_return_zero(self, api, auth_headers, fresh):
        # No txns at all → all amounts should be 0
        r = api.get(f"{BASE_URL}/api/analytics/monthly-trend?months=6", headers=auth_headers)
        body = r.json()
        for row in body["series"]:
            assert row["amount"] == 0

    def test_amounts_sum_debits_excluding_duplicates(self, api, auth_headers, fresh):
        mongo_db = fresh
        # Current month
        _insert_txn(mongo_db, merchant="A", amount=100, category="X", days_ago=1)
        _insert_txn(mongo_db, merchant="B", amount=200, category="X", days_ago=2)
        # credit — excluded
        _insert_txn(mongo_db, merchant="C", amount=9999, category="X", days_ago=3,
                    direction="credit")
        # duplicate — excluded
        _insert_txn(mongo_db, merchant="D", amount=1000, category="X", days_ago=3,
                    is_duplicate=True)

        r = api.get(f"{BASE_URL}/api/analytics/monthly-trend?months=6", headers=auth_headers)
        body = r.json()
        now_key = datetime.now(timezone.utc).strftime("%Y-%m")
        current = [row for row in body["series"] if row["month"] == now_key][0]
        assert current["amount"] == 300

    def test_months_param_clamped(self, api, auth_headers, fresh):
        # months clamped 1..12
        r1 = api.get(f"{BASE_URL}/api/analytics/monthly-trend?months=0", headers=auth_headers)
        assert r1.status_code == 200
        assert len(r1.json()["series"]) == 1
        r2 = api.get(f"{BASE_URL}/api/analytics/monthly-trend?months=99", headers=auth_headers)
        assert r2.status_code == 200
        assert len(r2.json()["series"]) == 12


# ============ Analytics: Recurring ============
class TestRecurring:
    def test_detects_recurring_within_15pct(self, api, auth_headers, fresh):
        mongo_db = fresh
        # Netflix in current, last, and 2-months-ago at similar amount (~649)
        _insert_txn(mongo_db, merchant="Netflix", amount=649, category="Entertainment", days_ago=2)
        _insert_txn(mongo_db, merchant="Netflix", amount=649, category="Entertainment", days_ago=35)
        _insert_txn(mongo_db, merchant="Netflix", amount=699, category="Entertainment", days_ago=70)
        # Random single-shot merchant — should be ignored (only one month)
        _insert_txn(mongo_db, merchant="OneOff", amount=1200, category="Shopping", days_ago=5)

        r = api.get(f"{BASE_URL}/api/analytics/recurring", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body and "total_monthly" in body
        merchants = {i["merchant"].lower(): i for i in body["items"]}
        assert "netflix" in merchants
        rec = merchants["netflix"]
        assert rec["months"] >= 2
        assert abs(rec["avg_amount"] - round((649+649+699)/3, 2)) < 0.5
        assert rec["category"] == "Entertainment"
        assert "last_seen" in rec
        # total_monthly matches sum of avg_amount
        assert round(sum(i["avg_amount"] for i in body["items"]), 2) == body["total_monthly"]
        # No _id leakage
        for i in body["items"]:
            assert "_id" not in i

    def test_excludes_when_amount_variance_over_15pct(self, api, auth_headers, fresh):
        mongo_db = fresh
        # Very different amounts across two months → should be excluded
        _insert_txn(mongo_db, merchant="Volatile", amount=100, category="X", days_ago=2)
        _insert_txn(mongo_db, merchant="Volatile", amount=1000, category="X", days_ago=35)
        r = api.get(f"{BASE_URL}/api/analytics/recurring", headers=auth_headers)
        body = r.json()
        assert not any(i["merchant"].lower() == "volatile" for i in body["items"])

    def test_excludes_single_month_only(self, api, auth_headers, fresh):
        mongo_db = fresh
        # Twice in the same month → not recurring
        _insert_txn(mongo_db, merchant="Sameonly", amount=200, category="X", days_ago=1)
        _insert_txn(mongo_db, merchant="Sameonly", amount=210, category="X", days_ago=3)
        r = api.get(f"{BASE_URL}/api/analytics/recurring", headers=auth_headers)
        body = r.json()
        assert not any(i["merchant"].lower() == "sameonly" for i in body["items"])

    def test_excludes_credits_and_duplicates(self, api, auth_headers, fresh):
        mongo_db = fresh
        # Credits should never count
        _insert_txn(mongo_db, merchant="Salary", amount=50000, category="X",
                    days_ago=2, direction="credit")
        _insert_txn(mongo_db, merchant="Salary", amount=50000, category="X",
                    days_ago=35, direction="credit")
        # Duplicates should never count
        _insert_txn(mongo_db, merchant="DupMerch", amount=100, category="X",
                    days_ago=2, is_duplicate=True)
        _insert_txn(mongo_db, merchant="DupMerch", amount=100, category="X",
                    days_ago=35, is_duplicate=True)
        r = api.get(f"{BASE_URL}/api/analytics/recurring", headers=auth_headers)
        body = r.json()
        assert not any(i["merchant"].lower() == "salary" for i in body["items"])
        assert not any(i["merchant"].lower() == "dupmerch" for i in body["items"])

    def test_dashboard_recurring_count_matches(self, api, auth_headers, fresh):
        mongo_db = fresh
        _insert_txn(mongo_db, merchant="Spotify", amount=119, category="Entertainment", days_ago=2)
        _insert_txn(mongo_db, merchant="Spotify", amount=119, category="Entertainment", days_ago=35)
        rec = api.get(f"{BASE_URL}/api/analytics/recurring", headers=auth_headers).json()
        d = api.get(f"{BASE_URL}/api/dashboard", headers=auth_headers).json()
        assert d["recurring_count"] == len(rec["items"])


# ============ Auth enforcement on new endpoints ============
class TestAuthEnforcementSprint2:
    @pytest.mark.parametrize("method,path,payload", [
        ("GET",    "/api/budgets", None),
        ("POST",   "/api/budgets", {"category": "X", "monthly_limit": 100}),
        ("DELETE", "/api/budgets/some-id", None),
        ("GET",    "/api/analytics/monthly-trend", None),
        ("GET",    "/api/analytics/monthly-trend?months=6", None),
        ("GET",    "/api/analytics/recurring", None),
    ])
    def test_no_auth_returns_401(self, api, method, path, payload):
        r = api.request(method, f"{BASE_URL}{path}", json=payload)
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}"

    @pytest.mark.parametrize("method,path", [
        ("GET",  "/api/budgets"),
        ("GET",  "/api/analytics/monthly-trend"),
        ("GET",  "/api/analytics/recurring"),
    ])
    def test_bad_bearer_returns_401(self, api, method, path):
        headers = {"Authorization": "Bearer garbage-token-999",
                   "Content-Type": "application/json"}
        r = api.request(method, f"{BASE_URL}{path}", headers=headers)
        assert r.status_code == 401
