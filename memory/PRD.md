# ExpenseSync — PRD (Sprint 1)

## Vision
Android-first personal finance app that automatically tracks every expense from bank SMS and email, deduplicates them, and gives users a clean spending overview.

## Sprint 1 scope (delivered)
- Google sign-in (Emergent-managed)
- Message ingest pipeline: paste any SMS/email → parse → store
- **Parsing engine**: Regex-first (Indian bank formats) with AI fallback via Claude Sonnet (Emergent LLM)
- **Deduplication**: same reference ID **OR** (same amount + normalized merchant + direction within ±1 day)
- Promotional / non-transaction message filtering
- Dashboard: monthly spend/income, category breakdown, recent transactions, duplicate banner
- Transactions list with category & source filters + duplicates toggle
- Transaction detail: change category, mark/un-mark duplicate, view raw text, delete
- Seed sample data for demo (since Expo Go cannot read SMS)
- Settings: profile, data-source status, log out

## Deferred to next sprint
- Native Android SMS auto-read (requires APK build + READ_SMS permission — added to app.json when we build)
- Gmail readonly sync (needs Google Cloud OAuth client with Gmail scope, separate from identity auth)
- Charts (pie/line)
- Budgets & alerts
- Merchant learning (remember user's category overrides)

## Tech stack
- Expo SDK 54 / React Native / expo-router
- FastAPI + MongoDB (motor)
- Emergent Google Auth + Emergent LLM (Claude Sonnet 4.6)

## Business enhancement idea
Once we have parsed transactions, we can offer **"Smart Bill Reminders"** — detect recurring subscriptions (Netflix, Spotify, telco) and remind users a day before the amount hits their account, driving daily retention.
