# Play Store Listing — Reference Content

Copy/paste starting points for the Play Console store listing. Edit freely — these are
drafts, not final copy. Character limits noted are Play Console's hard limits.

## Short description (max 80 characters)

```
Auto-track expenses from bank SMS — filtered on-device, private.
```
(66 characters)

## Full description (max 4000 characters)

```
Smart Expense automatically tracks your spending by reading bank and merchant
transaction messages — no manual entry required.

HOW IT WORKS
Grant SMS access and Smart Expense scans incoming messages for bank and
merchant transaction alerts. Filtering happens on your device first: only
messages that already look like a real transaction (a bank/merchant sender,
an amount, and a debit/credit keyword) are ever sent anywhere. Personal
messages, OTPs, and promotional texts never leave your phone.

FEATURES
• Automatic transaction detection from bank/merchant SMS
• Categorized spending breakdown
• Duplicate detection
• Manual entry and editing for anything the automatic scan misses
• Works fully in the background — no need to open the app after setup

YOUR DATA
Smart Expense only extracts financial transaction data — amount, merchant,
date, category. It does not read or store your personal conversations,
OTP codes, or any message that isn't already transaction-shaped, and this
filtering happens before anything is sent to our servers, not after.

Full privacy policy: https://smart-expense-backend-it1s.onrender.com/privacy
```

## Data Safety form — reference answers

Play Console → App content → Data safety. Go through "Manage data safety"; use these as
the answers for each data type this app actually collects.

### Does your app collect or share any of the required user data types?
**Yes**

### Data types collected

| Data type | Collected? | Shared with 3rd parties? | Purpose | Optional? |
|---|---|---|---|---|
| Name | Yes | No | Account management | No (required for sign-in) |
| Email address | Yes | No | Account management | No (required for sign-in) |
| SMS or MMS | Yes | No | App functionality (transaction detection) | Yes — user must grant permission |
| Financial info (transactions) | Yes | No | App functionality, analytics (your own spending shown to you) | No — core feature |

Answer "No" to sharing with third parties for all rows — data goes to your own backend
(MongoDB Atlas) and Google's auth APIs only, not to advertisers or data brokers.

### Security practices section
- "Is data encrypted in transit?" → **Yes** (HTTPS only, Render terminates TLS).
- "Do you provide a way for users to request data deletion?" → **Yes** — reference the
  privacy policy's contact email / account deletion process.
- "Is this data processed ephemerally?" → **No** for transaction data (stored so the user
  can see history); consider **Yes** for raw SMS content if you tighten backend retention
  later (see the open item about not persisting raw_text indefinitely, flagged earlier in
  the session).

### App category / target audience
- Category: **Finance** (or **Productivity**, depending on how you want to position it).
- Target age group: general audience, not primarily designed for children.

## Screenshots
Not included here — these need to be captured from the actual running app (phone or
emulator screens), which wasn't possible in this session since neither Xcode nor the
Android SDK is installed on this Mac yet. Minimum 2 phone screenshots required by Play
Console; capture once you can run the app.
