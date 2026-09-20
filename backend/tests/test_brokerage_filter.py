"""Direct unit check for regex_parse's brokerage-notice filter (no server or DB needed).
Run: pytest --noconftest -n 0 tests/test_brokerage_filter.py"""
from datetime import datetime, timezone
from server import regex_parse

NOW = datetime(2026, 9, 17, tzinfo=timezone.utc)

BROKER = ("Dear Client (6229027), sep 17 your valued Transactio Bill No - Received Rs.15926, "
          "and With Holding balance Rs.31756 click bit.ly/4yxoKn0 Regardssunflowerbroking")
BANK_DEBIT = ("Your account 456xxxx0841 has been debited on 10/09/2026 by INR 52,070.00 "
              "towards ECS.Available Balance:INR 1,447.85 -StanChart")
BANK_CREDIT = "Dear Customer, INR 5,000.00 credited to your A/c XX1234 on 12-09-2026. Avl Bal INR 9,000.00"


def test_broker_notice_is_not_a_transaction():
    assert regex_parse(BROKER, "sms", NOW) is None


def test_real_bank_messages_still_parse():
    assert regex_parse(BANK_DEBIT, "sms", NOW)["amount"] == 52070.0
    assert regex_parse(BANK_CREDIT, "sms", NOW)["direction"] == "credit"
