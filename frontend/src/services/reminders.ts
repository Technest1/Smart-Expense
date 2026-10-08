import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { apiFetch } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { formatINR } from '@/src/theme';

// Local, on-device reminders for upcoming payments. Nothing is sent to a server: the app
// asks the backend for the upcoming list and schedules Android notifications itself, so no
// push service or extra data collection is involved.
//
// Settings live on this device (AsyncStorage). The schedule is rebuilt from scratch each
// time (cancel all + reschedule), so it can never drift or duplicate.

const ON_KEY = 'reminders_enabled';
const DAYS_KEY = 'reminders_days_before';
const SENT_KEY = 'reminders_sent';
const CHANNEL = 'reminders';
const HOUR = 9; // local time reminders fire at
const LOOKAHEAD_DAYS = 35;

export type ReminderSettings = { enabled: boolean; daysBefore: 1 | 3 | 7 };

type Upcoming = { recurring_id: string; merchant: string; expected_amount: number; amount_type: string; expected_date: string; status: string };
type Pattern = { id: string; notify?: boolean };

if (Platform.OS === 'android') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
    }),
  });
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const enabled = !!(await storage.getItem<boolean>(ON_KEY, false));
  const d = Number(await storage.getItem<number>(DAYS_KEY, 3));
  return { enabled, daysBefore: (d === 1 || d === 7 ? d : 3) as 1 | 3 | 7 };
}

export async function saveReminderSettings(s: ReminderSettings) {
  await storage.setItem(ON_KEY, s.enabled);
  await storage.setItem(DAYS_KEY, s.daysBefore);
}

/** Asks Android for notification permission (needed on Android 13+). Returns whether granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Payment reminders', importance: Notifications.AndroidImportance.DEFAULT,
  });
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

const dayDiff = (iso: string, from: Date) => {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};

/** Rebuilds the schedule. Safe to call as often as you like. */
export async function syncReminders(): Promise<number> {
  if (Platform.OS !== 'android') return 0;
  const settings = await getReminderSettings();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.enabled) return 0;
  const cur = await Notifications.getPermissionsAsync();
  if (!cur.granted) return 0;

  const [up, pats] = await Promise.all([
    apiFetch<{ items: Upcoming[] }>(`/upcoming-expenses?days=${LOOKAHEAD_DAYS}`),
    apiFetch<{ items: Pattern[] }>('/recurring-payments'),
  ]);
  const muted = new Set(pats.items.filter((p) => p.notify === false).map((p) => p.id));
  const sent: string[] = (await storage.getItem<string>(SENT_KEY, '[]').then((v) => JSON.parse(v || '[]')).catch(() => [])) as string[];
  const now = new Date();
  let scheduled = 0;

  for (const u of up.items) {
    if (u.status !== 'EXPECTED' || muted.has(u.recurring_id)) continue;
    const left = dayDiff(u.expected_date, now);
    if (left < 0) continue;
    const key = `${u.recurring_id}:${u.expected_date}`;
    const when = new Date(u.expected_date + 'T00:00:00');
    when.setDate(when.getDate() - settings.daysBefore);
    when.setHours(HOUR, 0, 0, 0);
    const amount = (u.amount_type === 'VARIABLE' ? 'about ' : '') + formatINR(u.expected_amount);
    const content = {
      title: 'Upcoming payment',
      body: `${u.merchant} (${amount}) is expected ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}.`,
    };
    if (when.getTime() > now.getTime()) {
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL },
      });
      scheduled++;
    } else if (!sent.includes(key)) {
      // Reminder time already passed but the payment is still ahead: tell them once, now.
      await Notifications.scheduleNotificationAsync({ content, trigger: null });
      sent.push(key);
      scheduled++;
    }
  }
  await storage.setItem(SENT_KEY, JSON.stringify(sent.slice(-100)));
  return scheduled;
}
