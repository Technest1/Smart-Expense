"""Shared fixtures — seed test user/session in Mongo, provide auth headers."""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_USER_ID = "user_test000001"
TEST_EMAIL = "test@x.com"
TEST_TOKEN = "test-token-xyz-123"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="session", autouse=True)
def seed_test_session(mongo_db):
    """Seed a synthetic user + session per test_credentials.md before tests run."""
    mongo_db.users.update_one(
        {"user_id": TEST_USER_ID},
        {"$set": {
            "user_id": TEST_USER_ID,
            "email": TEST_EMAIL,
            "name": "Test User",
            "picture": None,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    mongo_db.user_sessions.update_one(
        {"session_token": TEST_TOKEN},
        {"$set": {
            "session_token": TEST_TOKEN,
            "user_id": TEST_USER_ID,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    # Clean previous test txns for isolation
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
    yield
    # Teardown - remove test data
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def clean_txns(mongo_db):
    """Wipe txns for the test user before a test."""
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
    yield
    mongo_db.transactions.delete_many({"user_id": TEST_USER_ID})
