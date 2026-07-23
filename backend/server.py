from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------- Mongo ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------- LLM (Emergent Integrations) ----------
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

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

class SessionCreateRequest(BaseModel):
    session_token: str

class TxnUpdateRequest(BaseModel):
    category: Optional[str] = None
    merchant: Optional[str] = None
    is_duplicate: Optional[bool] = None

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
@api_router.post("/auth/session")
async def create_session(payload: SessionCreateRequest):
    """Exchange Emergent session_token for a verified user + backend session."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            resp = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": payload.session_token},
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Auth verify failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session token")
    data = resp.json()
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    verified_token = data.get("session_token") or payload.session_token

    if not email:
        raise HTTPException(status_code=401, detail="Auth response missing email")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = User(user_id=user_id, email=email, name=name, picture=picture).dict()
        await db.users.insert_one(user_doc)

    session_doc = {
        "session_token": verified_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    }
    await db.user_sessions.update_one(
        {"session_token": verified_token}, {"$set": session_doc}, upsert=True
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": verified_token, "user": user_doc}

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
MERCHANT_RE = re.compile(r"(?:to|at|towards|for)\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{2,40}?)(?:\s+on|\s+ref|\s+upi|\s+txn|\.|,|$)", re.IGNORECASE)
ACCOUNT_RE = re.compile(r"a/?c\s*(?:no\.?)?\s*[xX*]*([0-9]{2,6})", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3})[-/]\d{2,4})\b")

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
        merchant = mm.group(1).strip(" .,-")
    ref = None
    rm = REF_RE.search(text)
    if rm:
        ref = rm.group(1).strip()
    account = None
    am = ACCOUNT_RE.search(text)
    if am:
        account = f"XX{am.group(1)}"

    return {
        "amount": amount,
        "direction": direction,
        "merchant": merchant[:60],
        "ref_id": ref,
        "account": account,
        "txn_date": received_at,
        "category": categorize(merchant, text),
        "parser": "regex",
    }

async def ai_parse(text: str, received_at: datetime) -> Optional[dict]:
    """Fallback AI parser using Emergent LLM (Claude Sonnet)."""
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning(f"emergentintegrations unavailable: {e}")
        return None

    system = (
        "You are a financial SMS/email parser. Extract structured JSON only. "
        "Return ONLY valid JSON with keys: amount(number), direction('debit'|'credit'), "
        "merchant(string), ref_id(string|null), account(string|null), "
        "category(string, one of: Food & Dining, Transport, Shopping, Groceries, "
        "Entertainment, Bills & Utilities, Health, Transfers, Uncategorized). "
        "If the text does NOT describe a real money transaction, return {\"skip\": true}. "
        "No markdown, no commentary."
    )
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"parse-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=text[:2000]))
        raw = resp if isinstance(resp, str) else getattr(resp, "content", str(resp))
        # Try to isolate JSON
        s = raw.strip()
        if s.startswith("```"):
            s = s.strip("`")
            if s.lower().startswith("json"):
                s = s[4:]
        js = json.loads(s)
        if js.get("skip"):
            return None
        amount = float(js["amount"])
        if amount <= 0:
            return None
        return {
            "amount": amount,
            "direction": js.get("direction", "debit"),
            "merchant": (js.get("merchant") or "Unknown")[:60],
            "ref_id": js.get("ref_id"),
            "account": js.get("account"),
            "txn_date": received_at,
            "category": js.get("category") or "Uncategorized",
            "parser": "ai",
        }
    except Exception as e:
        logger.warning(f"AI parse failed: {e}")
        return None

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
    saved = 0
    duplicates = 0
    skipped = 0
    results = []
    for item in payload.items:
        received_at = item.received_at or datetime.now(timezone.utc)
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
        parsed = regex_parse(item.text, item.source, received_at)
        if not parsed:
            parsed = await ai_parse(item.text, received_at)
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
            raw_text=item.text,
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
    # SMS - HDFC debit
    ("sms", "HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to SWIGGY BANGALORE. UPI Ref 512345678901. Not you? Call 18002586161",
     -1),
    # SMS - ICICI credit
    ("sms", "ICICI Bank Acct XX5678 credited with INR 25000.00 on 10-05-25; UPI:512300110022 from JOHN DOE. Available Bal INR 41,234.55",
     -3),
    # SMS - UPI to Uber
    ("sms", "Rs 285.00 debited via UPI to UBER INDIA. Ref no 512456789012 on 11-05-25. -Axis Bank",
     -2),
    # SMS - Amazon debit
    ("sms", "Your HDFC Credit Card XX9012 was used for Rs.1,299.00 at AMAZON on 09-05-25. Ref: 987654321",
     -4),
    # Duplicate of Swiggy (different ref, same amount/merchant/date)
    ("sms", "Rs.499.00 spent on HDFC Bank Card XX1234 at SWIGGY on 12-05-25. Avl Lmt: Rs.45000",
     -1),
    # SMS - Airtel bill
    ("sms", "Rs.899 debited from your account for AIRTEL POSTPAID BILL. Ref: AIRT88291. -SBI",
     -5),
    # Email - Netflix
    ("email", "Payment received for Netflix Premium subscription. Amount: INR 649.00 charged to card ending 4432 on 08-05-2025. Reference NTFX20250508.",
     -6),
    # Email - Flipkart
    ("email", "Your Flipkart order was placed. Rs. 2,499.00 paid via UPI on 07-05-2025. Transaction reference FKPKT7788221.",
     -7),
    # SMS - Zomato
    ("sms", "Rs. 342 spent at ZOMATO via UPI on 06-05-25. UPI Ref 501122334455. -HDFC",
     -8),
    # SMS - Promotional (should skip)
    ("sms", "Get 50% cashback up to Rs.500 on your next purchase. T&C apply. -Paytm",
     -1),
    # SMS - Salary credit
    ("email", "Your salary of INR 85000.00 has been credited to a/c XX5678 on 01-05-2025. Reference SAL20250501.",
     -11),
    # SMS - Metro
    ("sms", "Rs.60 debited via UPI to DMRC METRO on 12-05-25. UPI Ref 500987654321. -ICICI",
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
@api_router.get("/dashboard")
async def dashboard(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    txns = await db.transactions.find(
        {"user_id": user.user_id, "is_duplicate": False}, {"_id": 0}
    ).sort("txn_date", -1).to_list(1000)

    total_spend_month = 0.0
    total_income_month = 0.0
    by_category = {}
    for t in txns:
        td = t["txn_date"]
        if isinstance(td, str):
            try:
                td = datetime.fromisoformat(td)
            except Exception:
                td = now
        if td.tzinfo is None:
            td = td.replace(tzinfo=timezone.utc)
        if td >= month_start:
            if t["direction"] == "debit":
                total_spend_month += t["amount"]
                by_category[t["category"]] = by_category.get(t["category"], 0) + t["amount"]
            else:
                total_income_month += t["amount"]

    duplicate_count = await db.transactions.count_documents(
        {"user_id": user.user_id, "is_duplicate": True}
    )

    return {
        "month_spend": round(total_spend_month, 2),
        "month_income": round(total_income_month, 2),
        "by_category": [
            {"category": k, "amount": round(v, 2)} for k, v in
            sorted(by_category.items(), key=lambda x: -x[1])
        ],
        "duplicate_count": duplicate_count,
        "recent": txns[:5],
        "total_transactions": len(txns),
    }

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
    logger.info("Indexes ready.")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
