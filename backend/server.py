from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import uuid
from pathlib import Path
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_auth_requests
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------- Mongo ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------- Auth ----------
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# ---------- Security limits ----------
MAX_INGEST_ITEMS = 50
MAX_TXN_LIST_LIMIT = 500
MAX_INGEST_TEXT_CHARS = 4000

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ================= MODELS =================
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    amount: float
    currency: str = "INR"
    direction: Literal["debit", "credit"] = "debit"
    merchant: str
    category: str = "Uncategorized"
    txn_date: datetime
    source: Literal["sms", "email", "manual"] = "sms"
    account: Optional[str] = None
    ref_id: Optional[str] = None
    balance_after: Optional[float] = None
    raw_text: str = ""
    parser: Literal["regex", "ai", "manual"] = "regex"
    is_duplicate: bool = False
    duplicate_of: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class IngestItem(BaseModel):
    source: Literal["sms", "email", "manual"] = "sms"
    text: str
    sender: Optional[str] = None  # e.g. VM-HDFCBK
    received_at: Optional[datetime] = None

class IngestRequest(BaseModel):
    items: List[IngestItem]

class GoogleAuthRequest(BaseModel):
    id_token: str

class TxnUpdateRequest(BaseModel):
    category: Optional[str] = None
    merchant: Optional[str] = None
    is_duplicate: Optional[bool] = None

class Budget(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    category: str
    monthly_limit: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BudgetCreateRequest(BaseModel):
    category: str
    monthly_limit: float

# ================= AUTH HELPERS =================
async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)

# ================= AUTH ENDPOINTS =================
@api_router.post("/auth/google")
async def auth_google(payload: GoogleAuthRequest):
    """Verify a Google-issued id_token and mint our own backend session."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured")
    try:
        claims = google_id_token.verify_oauth2_token(
            payload.id_token, google_auth_requests.Request(), GOOGLE_CLIENT_ID
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google id_token: {e}")

    email = claims.get("email")
    name = claims.get("name") or email
    picture = claims.get("picture")

    if not email:
        raise HTTPException(status_code=401, detail="Google token missing email")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = User(user_id=user_id, email=email, name=name, picture=picture).dict()
        await db.users.insert_one(user_doc)

    session_token = uuid.uuid4().hex
    session_doc = {
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    }
    await db.user_sessions.update_one(
        {"session_token": session_token}, {"$set": session_doc}, upsert=True
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user_doc}

@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {"user": user.dict()}

@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}

# ================= PARSER =================
CATEGORY_KEYWORDS = {
    "Food & Dining": ["swiggy", "zomato", "restaurant", "cafe", "starbucks", "dominos", "mcd", "kfc", "food"],
    "Transport": ["uber", "ola", "rapido", "metro", "irctc", "petrol", "fuel", "hpcl", "iocl"],
    "Shopping": ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa"],
    "Groceries": ["bigbasket", "grofers", "blinkit", "zepto", "dmart", "grocery"],
    "Entertainment": ["netflix", "spotify", "prime", "hotstar", "youtube", "bookmyshow"],
    "Bills & Utilities": ["electricity", "airtel", "jio", "vodafone", "vi", "gas", "water", "bill"],
    "Health": ["pharmacy", "apollo", "medplus", "hospital", "clinic"],
    "Transfers": ["upi", "imps", "neft", "rtgs", "transfer"],
}

def categorize(merchant: str, text: str) -> str:
    hay = f"{merchant} {text}".lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k in hay for k in kws):
            return cat
    return "Uncategorized"

AMOUNT_RE = re.compile(r"(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.\d{1,2})?)", re.IGNORECASE)
DEBIT_RE = re.compile(r"\b(debited|debit|spent|paid|withdrawn|sent|used for|charged to)\b", re.IGNORECASE)
CREDIT_RE = re.compile(r"\b(credited|credit|received|deposited|refunded)\b", re.IGNORECASE)
PROMO_RE = re.compile(r"\b(cashback|discount|offer|reward|coupon|t&c\s*apply|apply now|earn up to|get\s+\d+%)\b", re.IGNORECASE)
REF_RE = re.compile(r"(?:ref(?:no|erence)?[:\s#]*|txn[:\s#]*|upi ref[:\s]*|imps[:\s]*)([A-Z0-9]{6,})", re.IGNORECASE)
# Prefer "to/at MERCHANT" but skip if next token is a currency marker.
MERCHANT_RE = re.compile(
    r"(?:to|at|towards|for)\s+"
    r"(?!(?:rs\.?|inr|₹))"
    r"([A-Za-z][A-Za-z0-9 &.'\-]{2,40}?)"
    r"(?:\s+on|\s+ref|\s+upi|\s+txn|\s+via|\.|,|$)",
    re.IGNORECASE,
)
# Fallback patterns for emails and less structured formats.
MERCHANT_EMAIL_RES = [
    re.compile(r"payment (?:received|made) for\s+([A-Za-z][A-Za-z0-9 &.'\-]{2,40}?)(?:\s+subscription|\.|,)", re.IGNORECASE),
    re.compile(r"your\s+([A-Za-z][A-Za-z0-9]{2,20})\s+order", re.IGNORECASE),
    re.compile(r"(?:from|by)\s+([A-Z][A-Za-z0-9 &.'\-]{2,40}?)(?:\s+(?:on|ref|for|upi|txn|via)\b|[.,]|$)"),
]
ACCOUNT_RE = re.compile(r"a/?c\s*(?:no\.?)?\s*[xX*]*([0-9]{2,6})", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3})[-/]\d{2,4})\b")
BALANCE_RE = re.compile(
    r"(?:avl(?:bl)?\.?\s*bal(?:ance)?|available\s*bal(?:ance)?|bal(?:ance)?)"
    r"[:\s]*(?:inr|rs\.?|₹)?\s*([0-9]{1,3}(?:[,][0-9]{2,3})*(?:\.\d{1,2})?)",
    re.IGNORECASE,
)

def regex_parse(text: str, source: str, received_at: datetime) -> Optional[dict]:
    if PROMO_RE.search(text):
        return None
    m = AMOUNT_RE.search(text)
    if not m:
        return None
    amount = float(m.group(1).replace(",", ""))
    if amount <= 0:
        return None
    debit = bool(DEBIT_RE.search(text))
    credit = bool(CREDIT_RE.search(text))
    if not (debit or credit):
        return None
    direction = "credit" if (credit and not debit) else "debit"

    merchant = "Unknown"
    mm = MERCHANT_RE.search(text)
    if mm:
        candidate = mm.group(1).strip(" .,-")
        first_word = candidate.split()[0].lower() if candidate.split() else ""
        if first_word not in {"card", "account", "acct", "a/c", "you", "your", "the"}:
            merchant = candidate
    if merchant == "Unknown" or not merchant:
        for pat in MERCHANT_EMAIL_RES:
            fm = pat.search(text)
            if fm:
                merchant = fm.group(1).strip(" .,-")
                break
    ref = None
    rm = REF_RE.search(text)
    if rm:
        ref = rm.group(1).strip()
    account = None
    am = ACCOUNT_RE.search(text)
    if am:
        account = f"XX{am.group(1)}"

    balance_after = None
    bm = BALANCE_RE.search(text)
    if bm:
        try:
            balance_after = float(bm.group(1).replace(",", ""))
        except Exception:
            balance_after = None

    return {
        "amount": amount,
        "direction": direction,
        "merchant": merchant[:60],
        "ref_id": ref,
        "account": account,
        "balance_after": balance_after,
        "txn_date": received_at,
        "category": categorize(merchant, text),
        "parser": "regex",
    }

def _merchant_key(m: str) -> str:
    """Normalize merchant to first significant token for fuzzy dedup."""
    tokens = re.split(r"[\s.,\-_]+", (m or "").lower().strip())
    tokens = [t for t in tokens if t and t not in {"india", "pvt", "ltd", "the", "inc"}]
    return tokens[0] if tokens else ""

async def is_duplicate(user_id: str, parsed: dict) -> Optional[str]:
    """Return existing txn id if duplicate."""
    if parsed.get("ref_id"):
        existing = await db.transactions.find_one(
            {"user_id": user_id, "ref_id": parsed["ref_id"]}, {"_id": 0, "id": 1}
        )
        if existing:
            return existing["id"]
    d = parsed["txn_date"]
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    start = d - timedelta(days=1)
    end = d + timedelta(days=1)
    mkey = _merchant_key(parsed["merchant"])
    q = {
        "user_id": user_id,
        "amount": parsed["amount"],
        "direction": parsed["direction"],
        "txn_date": {"$gte": start, "$lte": end},
    }
    candidates = await db.transactions.find(q, {"_id": 0, "id": 1, "merchant": 1}).to_list(20)
    for c in candidates:
        if _merchant_key(c.get("merchant", "")) == mkey and mkey:
            return c["id"]
    return None

# ================= INGEST =================
@api_router.post("/messages/ingest")
async def ingest_messages(payload: IngestRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    # SEC-001: cap batch size
    if len(payload.items) > MAX_INGEST_ITEMS:
        raise HTTPException(
            status_code=413,
            detail=f"Too many items in one request (max {MAX_INGEST_ITEMS})",
        )
    saved = 0
    duplicates = 0
    skipped = 0
    results = []
    for item in payload.items:
        # Cap individual text size to prevent giant payloads
        text = (item.text or "")[:MAX_INGEST_TEXT_CHARS]
        received_at = item.received_at or datetime.now(timezone.utc)
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
        parsed = regex_parse(text, item.source, received_at)
        if not parsed:
            skipped += 1
            results.append({"status": "skipped", "reason": "no_transaction_found"})
            continue

        dup_of = await is_duplicate(user.user_id, parsed)
        txn = Transaction(
            user_id=user.user_id,
            amount=parsed["amount"],
            direction=parsed["direction"],
            merchant=parsed["merchant"],
            category=parsed["category"],
            txn_date=parsed["txn_date"],
            source=item.source,
            account=parsed.get("account"),
            ref_id=parsed.get("ref_id"),
            balance_after=parsed.get("balance_after"),
            raw_text=text,
            parser=parsed["parser"],
            is_duplicate=bool(dup_of),
            duplicate_of=dup_of,
        )
        await db.transactions.insert_one(txn.dict())
        if dup_of:
            duplicates += 1
            results.append({"status": "duplicate", "id": txn.id, "duplicate_of": dup_of})
        else:
            saved += 1
            results.append({"status": "saved", "id": txn.id})
    return {"saved": saved, "duplicates": duplicates, "skipped": skipped, "results": results}

# ================= SEED SAMPLE =================
SAMPLE_MESSAGES = [
    # SMS - HDFC debit with balance
    ("sms", "HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to SWIGGY BANGALORE. UPI Ref 512345678901. Avl Bal: Rs.24,501.50. Not you? Call 18002586161",
     -1),
    # SMS - ICICI credit with balance
    ("sms", "ICICI Bank Acct XX5678 credited with INR 25000.00 on 10-05-25; UPI:512300110022 from JOHN DOE. Available Bal INR 41,234.55",
     -3),
    # SMS - UPI to Uber (Axis) with balance
    ("sms", "Rs 285.00 debited via UPI to UBER INDIA. Ref no 512456789012 on 11-05-25. Avl Bal Rs.12,455.00 -Axis Bank",
     -2),
    # SMS - Amazon debit on credit card (no balance)
    ("sms", "Your HDFC Credit Card XX9012 was used for Rs.1,299.00 at AMAZON on 09-05-25. Ref: 987654321",
     -4),
    # Duplicate of Swiggy (different ref, same amount/merchant/date)
    ("sms", "Rs.499.00 spent on HDFC Bank Card XX1234 at SWIGGY on 12-05-25. Avl Lmt: Rs.45000",
     -1),
    # SMS - Airtel bill (SBI) with balance
    ("sms", "Rs.899 debited from your account XX3344 for AIRTEL POSTPAID BILL. Ref: AIRT88291. Avl Bal Rs.8,201.00 -SBI",
     -5),
    # Email - Netflix
    ("email", "Payment received for Netflix Premium subscription. Amount: INR 649.00 charged to card ending 4432 on 08-05-2025. Reference NTFX20250508.",
     -6),
    # Email - Flipkart
    ("email", "Your Flipkart order was placed. Rs. 2,499.00 paid via UPI on 07-05-2025. Transaction reference FKPKT7788221.",
     -7),
    # SMS - Zomato
    ("sms", "Rs. 342 spent at ZOMATO via UPI on 06-05-25. UPI Ref 501122334455. Avl Bal Rs.23,860.50 -HDFC",
     -8),
    # SMS - Promotional (should skip)
    ("sms", "Get 50% cashback up to Rs.500 on your next purchase. T&C apply. -Paytm",
     -1),
    # Email - Salary credit
    ("email", "Your salary of INR 85000.00 has been credited to a/c XX5678 on 01-05-2025. Available Balance INR 126,234.55. Reference SAL20250501.",
     -11),
    # SMS - Metro (ICICI)
    ("sms", "Rs.60 debited via UPI to DMRC METRO on 12-05-25. UPI Ref 500987654321. Avl Bal Rs.41,174.55 -ICICI",
     -1),
]

@api_router.post("/messages/seed-sample")
async def seed_sample(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    now = datetime.now(timezone.utc)
    items = []
    for src, txt, day_offset in SAMPLE_MESSAGES:
        items.append(IngestItem(source=src, text=txt, received_at=now + timedelta(days=day_offset)))
    return await ingest_messages(IngestRequest(items=items), authorization=authorization)

# ================= TRANSACTIONS =================
@api_router.get("/transactions")
async def list_transactions(
    authorization: Optional[str] = Header(None),
    category: Optional[str] = None,
    source: Optional[str] = None,
    include_duplicates: bool = True,
    limit: int = 200,
):
    user = await get_current_user(authorization)
    # Hardening: cap the limit
    limit = max(1, min(limit, MAX_TXN_LIST_LIMIT))
    q = {"user_id": user.user_id}
    if category:
        q["category"] = category
    if source:
        q["source"] = source
    if not include_duplicates:
        q["is_duplicate"] = False
    cursor = db.transactions.find(q, {"_id": 0}).sort("txn_date", -1).limit(limit)
    items = await cursor.to_list(limit)
    return {"items": items}

@api_router.get("/transactions/{txn_id}")
async def get_txn(txn_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    t = await db.transactions.find_one({"id": txn_id, "user_id": user.user_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    return t

@api_router.patch("/transactions/{txn_id}")
async def update_txn(txn_id: str, payload: TxnUpdateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        return {"ok": True}
    r = await db.transactions.update_one({"id": txn_id, "user_id": user.user_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    t = await db.transactions.find_one({"id": txn_id}, {"_id": 0})
    return t

@api_router.delete("/transactions/{txn_id}")
async def delete_txn(txn_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    r = await db.transactions.delete_one({"id": txn_id, "user_id": user.user_id})
    return {"deleted": r.deleted_count}

# ================= DASHBOARD =================
def _resolve_date_range(range_key: Optional[str], start: Optional[str], end: Optional[str]):
    """Return (start_dt, end_dt, label). range_key one of: today, week, month, custom, all."""
    now = datetime.now(timezone.utc)
    key = (range_key or "month").lower()
    if key == "today":
        s = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return s, now, "Today"
    if key == "week":
        s = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        return s, now, "Last 7 days"
    if key == "all":
        s = datetime(2000, 1, 1, tzinfo=timezone.utc)
        return s, now, "All time"
    if key == "custom" and (start or end):
        try:
            s = datetime.fromisoformat(start) if start else now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            e = datetime.fromisoformat(end) if end else now
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid start/end ISO datetime")
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        if e.tzinfo is None:
            e = e.replace(tzinfo=timezone.utc)
        if e < s:
            raise HTTPException(status_code=400, detail="end must be >= start")
        return s, e, "Custom"
    # default: month
    s = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return s, now, "This month"


@api_router.get("/dashboard")
async def dashboard(
    authorization: Optional[str] = Header(None),
    range: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    user = await get_current_user(authorization)
    start_dt, end_dt, label = _resolve_date_range(range, start, end)

    txns = await db.transactions.find(
        {
            "user_id": user.user_id,
            "is_duplicate": False,
            "txn_date": {"$gte": start_dt, "$lte": end_dt},
        },
        {"_id": 0},
    ).sort("txn_date", -1).to_list(2000)

    total_spend = 0.0
    total_income = 0.0
    by_category: dict = {}
    for t in txns:
        if t["direction"] == "debit":
            total_spend += t["amount"]
            by_category[t["category"]] = by_category.get(t["category"], 0) + t["amount"]
        else:
            total_income += t["amount"]

    duplicate_count = await db.transactions.count_documents(
        {"user_id": user.user_id, "is_duplicate": True}
    )

    # Budgets — only make sense for the current month window
    budgets_out = []
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    is_current_month = start_dt >= month_start and end_dt >= month_start
    if is_current_month:
        budgets_docs = await db.budgets.find({"user_id": user.user_id}, {"_id": 0}).to_list(50)
        for b in budgets_docs:
            spent = round(by_category.get(b["category"], 0), 2)
            pct = round((spent / b["monthly_limit"] * 100), 1) if b["monthly_limit"] else 0.0
            budgets_out.append({
                "id": b["id"],
                "category": b["category"],
                "monthly_limit": b["monthly_limit"],
                "spent": spent,
                "pct": pct,
                "over_budget": spent >= b["monthly_limit"],
                "near_limit": (not (spent >= b["monthly_limit"])) and pct >= 80.0,
            })
        budgets_out.sort(key=lambda x: -x["pct"])

    recurring_count = 0
    try:
        recs = await _detect_recurring(user.user_id)
        recurring_count = len(recs)
    except Exception:
        recurring_count = 0

    return {
        "range": {"key": (range or "month").lower(), "label": label,
                  "start": start_dt.isoformat(), "end": end_dt.isoformat()},
        "month_spend": round(total_spend, 2),
        "month_income": round(total_income, 2),
        "by_category": [
            {"category": k, "amount": round(v, 2)} for k, v in
            sorted(by_category.items(), key=lambda x: -x[1])
        ],
        "duplicate_count": duplicate_count,
        "recent": txns[:5],
        "total_transactions": len(txns),
        "budgets": budgets_out,
        "recurring_count": recurring_count,
    }

# ================= BUDGETS =================
@api_router.get("/budgets")
async def list_budgets(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.budgets.find({"user_id": user.user_id}, {"_id": 0}).to_list(50)
    return {"items": items}

@api_router.post("/budgets")
async def upsert_budget(payload: BudgetCreateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if payload.monthly_limit <= 0:
        raise HTTPException(status_code=400, detail="monthly_limit must be > 0")
    existing = await db.budgets.find_one(
        {"user_id": user.user_id, "category": payload.category}, {"_id": 0}
    )
    if existing:
        await db.budgets.update_one(
            {"id": existing["id"]}, {"$set": {"monthly_limit": payload.monthly_limit}}
        )
        existing["monthly_limit"] = payload.monthly_limit
        return existing
    b = Budget(user_id=user.user_id, category=payload.category, monthly_limit=payload.monthly_limit)
    await db.budgets.insert_one(b.dict())
    return b.dict()

@api_router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    r = await db.budgets.delete_one({"id": budget_id, "user_id": user.user_id})
    return {"deleted": r.deleted_count}

# ================= ANALYTICS =================
def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")

@api_router.get("/analytics/monthly-trend")
async def monthly_trend(months: int = 6, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    months = max(1, min(months, 12))
    now = datetime.now(timezone.utc)
    start = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
             - timedelta(days=32 * (months - 1))).replace(day=1)

    txns = await db.transactions.find(
        {"user_id": user.user_id, "is_duplicate": False, "direction": "debit",
         "txn_date": {"$gte": start}},
        {"_id": 0, "amount": 1, "txn_date": 1},
    ).to_list(5000)

    buckets = {}
    for t in txns:
        td = t["txn_date"]
        if isinstance(td, str):
            try: td = datetime.fromisoformat(td)
            except Exception: continue
        if td.tzinfo is None:
            td = td.replace(tzinfo=timezone.utc)
        buckets[_month_key(td)] = buckets.get(_month_key(td), 0) + t["amount"]

    # Build ordered list of the last N months
    series = []
    cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    seen = []
    for _ in range(months):
        key = _month_key(cursor)
        seen.append((key, cursor))
        # step back one month
        prev_month_last = cursor - timedelta(days=1)
        cursor = prev_month_last.replace(day=1)
    seen.reverse()
    for key, dt in seen:
        series.append({
            "month": key,
            "label": dt.strftime("%b"),
            "amount": round(buckets.get(key, 0), 2),
        })
    return {"series": series}

async def _detect_recurring(user_id: str) -> list:
    """Merchants appearing as debit in >=2 distinct months in the last 4 months
    with amounts within ±15%."""
    now = datetime.now(timezone.utc)
    four_months_ago = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                       - timedelta(days=32 * 3)).replace(day=1)
    txns = await db.transactions.find(
        {"user_id": user_id, "is_duplicate": False, "direction": "debit",
         "txn_date": {"$gte": four_months_ago}},
        {"_id": 0, "merchant": 1, "amount": 1, "txn_date": 1, "category": 1},
    ).to_list(5000)

    by_merchant = {}
    for t in txns:
        key = _merchant_key(t.get("merchant", ""))
        if not key:
            continue
        td = t["txn_date"]
        if isinstance(td, str):
            try: td = datetime.fromisoformat(td)
            except Exception: continue
        if td.tzinfo is None:
            td = td.replace(tzinfo=timezone.utc)
        by_merchant.setdefault(key, []).append({
            "merchant": t["merchant"],
            "amount": t["amount"],
            "month": _month_key(td),
            "category": t.get("category", "Uncategorized"),
            "txn_date": td,
        })

    results = []
    for key, entries in by_merchant.items():
        months = sorted({e["month"] for e in entries})
        if len(months) < 2:
            continue
        avg = sum(e["amount"] for e in entries) / len(entries)
        # keep only if amounts consistent within +/- 15%
        if any(abs(e["amount"] - avg) / avg > 0.15 for e in entries):
            continue
        latest = max(entries, key=lambda e: e["txn_date"])
        results.append({
            "merchant": latest["merchant"],
            "category": latest["category"],
            "avg_amount": round(avg, 2),
            "months": len(months),
            "last_seen": latest["txn_date"].isoformat(),
        })
    results.sort(key=lambda x: (-x["months"], -x["avg_amount"]))
    return results

@api_router.get("/analytics/recurring")
async def analytics_recurring(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await _detect_recurring(user.user_id)
    return {"items": items, "total_monthly": round(sum(x["avg_amount"] for x in items), 2)}

@api_router.get("/analytics/by-merchant")
async def analytics_by_merchant(
    authorization: Optional[str] = Header(None),
    range: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 20,
):
    user = await get_current_user(authorization)
    start_dt, end_dt, label = _resolve_date_range(range, start, end)
    limit = max(1, min(limit, 100))
    txns = await db.transactions.find(
        {
            "user_id": user.user_id, "is_duplicate": False, "direction": "debit",
            "txn_date": {"$gte": start_dt, "$lte": end_dt},
        },
        {"_id": 0, "merchant": 1, "amount": 1, "category": 1},
    ).to_list(5000)

    grouped: dict = {}
    for t in txns:
        key = _merchant_key(t.get("merchant", ""))
        if not key:
            continue
        g = grouped.setdefault(key, {
            "merchant": t["merchant"],
            "category": t.get("category", "Uncategorized"),
            "total": 0.0, "count": 0,
        })
        # Keep the longer/most detailed merchant name we've seen
        if len(t.get("merchant", "")) > len(g["merchant"]):
            g["merchant"] = t["merchant"]
        g["total"] += t["amount"]
        g["count"] += 1
    items = sorted(grouped.values(), key=lambda x: -x["total"])[:limit]
    for i in items:
        i["total"] = round(i["total"], 2)
        i["avg"] = round(i["total"] / max(i["count"], 1), 2)
    return {
        "range": {"key": (range or "month").lower(), "label": label,
                  "start": start_dt.isoformat(), "end": end_dt.isoformat()},
        "items": items,
    }

# ================= ACCOUNTS =================
@api_router.get("/accounts/balances")
async def account_balances(authorization: Optional[str] = Header(None)):
    """Return the last-known balance per account (if any SMS reported one)."""
    user = await get_current_user(authorization)
    txns = await db.transactions.find(
        {"user_id": user.user_id, "account": {"$ne": None},
         "balance_after": {"$ne": None}, "is_duplicate": False},
        {"_id": 0, "account": 1, "balance_after": 1, "txn_date": 1},
    ).sort("txn_date", -1).to_list(2000)

    latest: dict = {}
    for t in txns:
        acc = t["account"]
        if acc in latest:
            continue
        latest[acc] = {
            "account": acc,
            "balance": round(t["balance_after"], 2),
            "as_of": t["txn_date"].isoformat() if hasattr(t["txn_date"], "isoformat") else t["txn_date"],
        }
    items = sorted(latest.values(), key=lambda x: -x["balance"])
    total = round(sum(x["balance"] for x in items), 2)
    return {"items": items, "total": total}

# ================= HEALTH =================
@api_router.get("/")
async def root():
    return {"message": "ExpenseSync API", "ok": True}

# ---------- STARTUP ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    try:
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        pass
    await db.transactions.create_index([("user_id", 1), ("txn_date", -1)])
    await db.transactions.create_index([("user_id", 1), ("ref_id", 1)])
    await db.budgets.create_index([("user_id", 1), ("category", 1)], unique=True)
    logger.info("Indexes ready.")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
