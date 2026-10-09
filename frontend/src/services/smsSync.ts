import { Platform, NativeModules } from 'react-native';
import { getToken, apiFetch } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { looksLikeTransaction } from './transactionFilter';

const SmsAndroid = NativeModules.Sms;

export const LAST_SYNC_KEY = 'expensesync_sms_last_sync_ms';
// which account the stored sync marker belongs to (a marker is only valid for that account)
export const SYNC_USER_KEY = 'expensesync_sms_synced_user';

/** Forget how far we read, so the next sync re-reads the whole inbox (duplicates are filtered server-side). */
export async function resetSmsCursor() {
  await storage.removeItem(LAST_SYNC_KEY);
}
const BATCH_SIZE = 50; // matches backend MAX_INGEST_ITEMS in server.py

// Bank/merchant SMS come from short alphanumeric sender IDs (e.g. "VM-HDFCBK"), not
// plain phone numbers — this cuts obvious personal-contact noise before it ever
// reaches the backend.
function looksLikeSenderId(address: string): boolean {
  return !/^\+?[0-9\s-]+$/.test(address.trim());
}

type RawSms = { _id: number; address: string; body: string; date: string };

function listInboxSince(minDate: number): Promise<RawSms[]> {
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({ box: 'inbox', minDate, indexFrom: 0, maxCount: 500 }),
      (err: string) => reject(new Error(err)),
      (_count: number, jsonArray: string) => resolve(JSON.parse(jsonArray))
    );
  });
}

export type SmsSyncResult = { saved: number; duplicates: number; skipped: number; scanned: number };

export async function runSmsSync(): Promise<SmsSyncResult> {
  const empty: SmsSyncResult = { saved: 0, duplicates: 0, skipped: 0, scanned: 0 };
  if (Platform.OS !== 'android' || !SmsAndroid) return empty;

  const token = await getToken();
  if (!token) return empty; // not signed in — nothing to do

  const lastSync = await storage.getItem<number>(LAST_SYNC_KEY, 0);
  // +1: minDate is inclusive, so without it the newest already-synced SMS is re-sent
  // every run and shows up as a duplicate transaction.
  const messages = await listInboxSince((lastSync ?? 0) + 1);
  const candidates = messages.filter((m) => looksLikeSenderId(m.address));

  // Content filtering happens here, on-device, before anything is sent over the
  // network — not just in the backend's regex_parse(). Non-transactional messages
  // (OTPs, promos, delivery notices, "payment failed" alerts, etc.) never leave the
  // phone, which is what Google Play's SMS-based-money-management exception requires.
  let newestDate = lastSync ?? 0;
  for (const m of candidates) newestDate = Math.max(newestDate, Number(m.date));
  const transactional = candidates.filter((m) => looksLikeTransaction(m.body));

  const totals: SmsSyncResult = {
    saved: 0,
    duplicates: 0,
    skipped: candidates.length - transactional.length,
    scanned: candidates.length,
  };

  for (let i = 0; i < transactional.length; i += BATCH_SIZE) {
    const batch = transactional.slice(i, i + BATCH_SIZE);
    const items = batch.map((m) => ({
      source: 'sms' as const,
      text: m.body,
      sender: m.address,
      received_at: new Date(Number(m.date)).toISOString(),
    }));
    const result = await apiFetch<{ saved: number; duplicates: number; skipped: number }>(
      '/messages/ingest',
      { method: 'POST', body: JSON.stringify({ items }) }
    );
    totals.saved += result.saved;
    totals.duplicates += result.duplicates;
    totals.skipped += result.skipped;
  }

  if (newestDate > (lastSync ?? 0)) {
    await storage.setItem(LAST_SYNC_KEY, newestDate);
  }

  return totals;
}
