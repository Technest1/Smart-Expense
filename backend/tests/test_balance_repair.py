"""Run: pytest --noconftest tests/test_balance_repair.py  (needs mongomock-motor)"""
import asyncio, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1"); os.environ.setdefault("DB_NAME", "t")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "x" * 43 + "=")
from mongomock_motor import AsyncMongoMockClient
import server


def test_repair_fixes_misread_balances_once_and_touches_nothing_else():
    async def run():
        server.db = AsyncMongoMockClient()["t"]
        db = server.db
        await db.transactions.insert_many([
            {"id": "a", "user_id": "u", "raw_text": "Rs.100 credited. Avl Bal Rs.126434.00 -PNB", "balance_after": 126.0, "amount": 100.0},
            {"id": "b", "user_id": "u", "raw_text": "Rs.5 debited. Avl Bal Rs 1,26,434.00", "balance_after": 126434.0, "amount": 5.0},   # already right
            {"id": "c", "user_id": "u", "raw_text": "Rs.5 debited, no balance printed", "balance_after": None, "amount": 5.0},
            {"id": "d", "user_id": "u", "raw_text": "Manually added: Tea", "balance_after": None, "amount": 20.0},
            {"id": "e", "user_id": "u", "raw_text": "Rs.9 debited. Avl Bal INR 124934.50", "balance_after": None, "amount": 9.0},    # previously unread
        ])
        assert await server.repair_balances() == 2
        got = {t["id"]: t["balance_after"] async for t in db.transactions.find({})}
        assert got == {"a": 126434.0, "b": 126434.0, "c": None, "d": None, "e": 124934.5}
        assert await server.repair_balances() == 0          # flagged: does not run twice
    asyncio.new_event_loop().run_until_complete(run())
