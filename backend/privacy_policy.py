PRIVACY_POLICY_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Expense — Privacy Policy</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 720px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  .updated { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  ul { padding-left: 1.25rem; }
  code { background: #f2f2f2; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
<h1>Smart Expense — Privacy Policy</h1>
<p class="updated">Last updated: July 30, 2026</p>

<p>Smart Expense ("the App") is a personal expense-tracking app. This policy explains what
data the App accesses, why, how it's stored, and how you can control or delete it.</p>

<h2>1. Data we access and why</h2>
<ul>
  <li><strong>SMS messages (Android only, with your permission):</strong> if you grant the
  <code>READ_SMS</code> / <code>RECEIVE_SMS</code> permission, the App reads incoming SMS to
  find bank and merchant transaction notifications. Filtering happens on your device first —
  only messages from bank/merchant-style sender IDs that already look like a real transaction
  (contain an amount and a debit/credit/payment keyword) are sent to our server. Personal
  messages, OTPs, promotional texts, and non-financial content are never transmitted.</li>
  <li><strong>Gmail (optional, read-only):</strong> if you connect Gmail, the App requests the
  <code>gmail.readonly</code> scope to periodically scan for bank/transaction emails, using the
  same transaction-detection logic as SMS. We do not read, store, or share any other email
  content, and we never send email on your behalf.</li>
  <li><strong>Google account basic profile:</strong> your name, email address, and profile
  picture, used solely to identify your account and let you sign in.</li>
  <li><strong>Transaction data you generate:</strong> amounts, merchants, categories, dates, and
  account references extracted from the messages above, or entered manually by you.</li>
</ul>

<h2>2. How we store and protect your data</h2>
<p>Data is stored in a MongoDB Atlas database operated on our behalf as a data processor.
Gmail OAuth refresh tokens are encrypted at rest. We do not sell your data, and we do not
share it with advertisers or data brokers.</p>

<h2>3. Google user data — Limited Use disclosure</h2>
<p>The App's use and transfer of information received from Google APIs adheres to the
<a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">
Google API Services User Data Policy</a>, including the Limited Use requirements. Gmail data is
used exclusively to detect and record your own financial transactions inside the App, is never
used for advertising, and is never shared with third parties except as required to provide this
core feature.</p>

<h2>4. Data retention and deletion</h2>
<p>You can disconnect Gmail and revoke SMS permission at any time from within the App or your
device settings. To request deletion of your account and all associated data, contact us at
the email below — we will delete your data within 30 days of a verified request.</p>

<h2>5. Third-party sharing</h2>
<p>We do not share your personal data with third parties, except infrastructure providers
(database hosting, Google authentication) strictly necessary to operate the App, each bound
to protect your data.</p>

<h2>6. Children's privacy</h2>
<p>The App is not directed at children under 13, and we do not knowingly collect data from
them.</p>

<h2>7. Changes to this policy</h2>
<p>We may update this policy from time to time. Material changes will be reflected by updating
the "Last updated" date above.</p>

<h2>8. Contact us</h2>
<p>Questions about this policy or your data: <a href="mailto:technest05@gmail.com">technest05@gmail.com</a></p>

</body>
</html>
"""
