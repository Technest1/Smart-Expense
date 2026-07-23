# ExpenseSync — PRD

## Vision
Android-first personal finance app that automatically tracks every expense from bank SMS and email, deduplicates them, and gives users a clean spending overview.

## Sprint 1 (shipped)
- Google sign-in (Emergent-managed)
- Message ingest: paste any SMS/email → parse → store
- **Parsing**: Regex-first (Indian bank formats) + Claude Sonnet AI fallback (Emergent LLM)
- **Dedup**: same ref_id OR (same amount + normalized merchant + direction ± 1 day)
- Promotional-SMS filtering
- Dashboard, Transactions list w/ filters, Transaction detail, Settings

## Sprint 2 (shipped)
- **Analytics tab**: donut (categories), monthly-trend bar chart (last 6 months), recurring subscriptions list
- **Budgets & alerts** (Settings → Budgets): set monthly cap per category; over-budget & near-limit indicators; dashboard alert cards
- **Recurring detection**: merchants debited in ≥2 distinct months (last 4) with amounts within ±15% surfaced as subscriptions
- **SMS permission scaffold**: `READ_SMS` + `RECEIVE_SMS` declared in app.json; new `/sms-sync` screen requests the permission (works only after APK build; graceful fallback UI in preview)

## Deferred (Sprint 3 candidates)
- **b4. Gmail readonly sync** — needs a Google Cloud OAuth client with `gmail.readonly` scope from user
- **b5. Real native SMS reader** — add `react-native-get-sms-android` or custom Expo config plugin; light up after APK build
- **b1. Push notifications for subscription reminders** — Emergent-managed push, testable only in the built app
- Merchant-learning (remember user category overrides)

## Tech stack
- Expo SDK 54 / React Native / expo-router / react-native-svg
- FastAPI + MongoDB (motor)
- Emergent Google Auth + Emergent LLM (Claude Sonnet 4.6)

## Business enhancement idea
Once subscription detection is proven, upsell **"Smart Bill Reminders"** — remind users 1 day before a recurring charge hits. Combined with budgets & alerts, this transforms a passive tracker into an active money-saving assistant → strong daily-retention hook.
