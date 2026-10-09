"""Test-only sample bank messages. The server ships no sample data; the integration tests
import these and send them through the normal /api/messages/ingest endpoint."""
from datetime import datetime, timedelta, timezone

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


def seed_payload():
    now = datetime.now(timezone.utc)
    return {"items": [{"source": src, "text": txt, "received_at": (now + timedelta(days=off)).isoformat()}
                      for src, txt, off in SAMPLE_MESSAGES]}
