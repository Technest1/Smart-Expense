# SMS Permissions Declaration Form — Reference Content

Play Console → App content → Permissions declaration form (appears once you upload a
build declaring `READ_SMS`/`RECEIVE_SMS`). Draft answers below — edit to your voice, but
keep the core claims accurate since Google checks them against the actual app behavior.

## Core use case
Select: **"SMS-based money management"** — the exception described as "apps that track
and manage budget." This directly matches what Smart Expense does.

## Why does your app need this permission? (free text field)

```
Smart Expense is a personal budget-tracking app. Its core function is detecting
financial transactions from bank/merchant SMS so the user doesn't have to enter
spending manually. READ_SMS lets the app scan the inbox for these messages;
RECEIVE_SMS lets it pick up new transaction alerts in the background without the
user needing to reopen the app.

All filtering happens on-device before anything is transmitted: the app only
forwards messages that (a) come from a bank/merchant-style sender ID, not a
personal contact, and (b) already contain an amount and a debit/credit/payment
keyword. Personal messages, OTPs, and promotional texts are never sent anywhere.
Budget tracking is the app's only purpose — it has no unrelated core features
this permission is being smuggled in alongside.
```

## Demo video script

Google requires a video (YouTube unlisted, or mp4 upload) showing the actual permission
request and usage. Suggested shot list, ~60-90 seconds total, recorded on a real device
or emulator running the installed app:

1. **(0:00-0:10)** Launch the app, show the sign-in screen, sign in.
2. **(0:10-0:25)** Navigate to the SMS sync screen. Show the explanatory text on-screen
   (the app already displays: *"We check messages on your device first — only ones from
   bank/merchant sender IDs... that actually look like a transaction are sent for
   parsing; everything else... never leaves your phone."*). Tap "Request SMS permission"
   and show the Android system permission dialog appearing, then grant it.
3. **(0:25-0:45)** Tap "Sync now". Show the sync summary result (scanned / saved /
   duplicates / skipped counts).
4. **(0:45-1:00)** Navigate to the transactions list, show a real transaction that was
   auto-detected from an SMS, tap into it to show the detail (merchant, amount, category)
   came from the message, not manual entry.
5. **(1:00-1:15, optional)** Show a counter-example: send/have a promotional or OTP text
   arrive, run sync again, and show it was NOT added as a transaction — demonstrates the
   filtering claim concretely.

Keep the video unlisted (not public) on YouTube, or upload directly as mp4 if the form
allows — either is accepted.

## Submission notes
- This form can only be filled in and submitted by whoever owns the Play Console account
  — I can't submit it on your behalf.
- Google's review for this can take **up to several weeks**; the app version stays in
  pending-publication status until approved. Plan any launch date around this.
- You'll need a real signed build uploaded to a Play Console track (internal testing is
  fine) before this form becomes available — it's tied to a specific app version.

---

# Deferred to v2: Gmail `gmail.readonly` scope verification

**Resolved for v1 — Gmail sync is deferred to v2, not shipping now.** The
`offlineAccess`/`gmail.readonly` scope request has been removed from
`frontend/app/login.tsx`, so v1's OAuth consent screen doesn't request any restricted
scope and doesn't need the process below. The backend Gmail-sync code
(`_connect_gmail`, `sync_user_gmail`, etc. in `backend/server.py`) is left in place,
unused, ready to wire back up when v2 takes this on. Keeping this writeup below for
when that happens.

---

While preparing the privacy policy, we found the app also requests the Gmail
**`gmail.readonly`** OAuth scope (frontend/app/login.tsx) to scan email for transactions.
This is a **restricted scope** under Google's API Services User Data Policy — a
completely separate process from the Play Store SMS declaration above, run through
Google Cloud Console / OAuth consent screen, not Play Console.

**What it requires:**
- **Brand verification** of your OAuth consent screen (a few business days).
- An **annual third-party security assessment** via the App Defense Alliance / CASA
  framework — this is a real audit, not a form, and can take **weeks**. Cost varies by
  assessment tier; check current CASA tier pricing before committing to a timeline.
- A **demonstration video of the OAuth consent flow** itself (separate from the SMS video
  above).
- Your privacy policy must explicitly disclose Gmail data use and the Limited Use
  clause — this was removed from the privacy policy along with the v1 Gmail scope
  removal (it only belongs there while the app actually requests the scope); re-add a
  Gmail section with the Limited Use disclosure when v2 wires this back up.

**Exception:** if your OAuth consent screen stays in **"Testing"** mode, verification
isn't required — but the app is then capped at 100 test users and refresh tokens expire
after 7 days, which isn't viable for a real public release.

This is worth deciding on deliberately: either budget the time/cost for full Gmail
verification, or consider whether the Gmail-sync feature is worth shipping in v1 at all
versus SMS-only (which only needs the Play Console declaration above, not a CASA audit).

Sources:
- [Restricted scope verification – Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
