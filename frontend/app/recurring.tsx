import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme, CATEGORY_COLORS, CATEGORY_ICONS, formatINR } from '@/src/theme';

type Pattern = {
  id: string; merchant: string; category: string; account: string | null; frequency: string;
  amount_type: 'FIXED' | 'VARIABLE'; expected_amount: number; amount_min: number; amount_max: number;
  next_date: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; status: string; occurrence_count: number;
  history: { date: string; amount: number }[];
};
type Upcoming = {
  recurring_id: string; merchant: string; category: string; account: string | null;
  expected_amount: number; amount_type: string; expected_date: string; status: 'EXPECTED' | 'MISSED';
};
type Summary = {
  next_7_days: number; next_30_days: number; next_90_days: number;
  count_7_days: number; count_30_days: number; count_90_days: number;
};

const PER: Record<string, string> = {
  WEEKLY: 'week', FORTNIGHTLY: '2 weeks', MONTHLY: 'month', QUARTERLY: 'quarter',
  HALF_YEARLY: '6 months', YEARLY: 'year',
};
const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const amountText = (a: number, type: string) => (type === 'VARIABLE' ? '~' : '') + formatINR(a);

export default function RecurringScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [days, setDays] = useState(30);
  const [sheet, setSheet] = useState<Pattern | null>(null);

  const load = useCallback(async (d: number) => {
    try {
      const [s, u, p] = await Promise.all([
        apiFetch<Summary>('/upcoming-expenses/summary'),
        apiFetch<{ items: Upcoming[] }>(`/upcoming-expenses?days=${d}`),
        apiFetch<{ items: Pattern[] }>('/recurring-payments'),
      ]);
      setSummary(s); setUpcoming(u.items); setPatterns(p.items);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load(days).finally(() => setLoading(false));
  }, [load, days]));

  const act = async (p: Pattern, action: string) => {
    setSheet(null);
    try { await apiFetch(`/recurring-payments/${p.id}/${action}`, { method: 'POST' }); } catch {}
    await load(days);
  };

  const skip = (u: Upcoming) =>
    Alert.alert(`Skip ${u.merchant}?`, `Remove the ${fmtDate(u.expected_date)} payment from your upcoming list. Future payments stay.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Skip', onPress: async () => {
          try {
            await apiFetch('/upcoming-expenses/skip', {
              method: 'POST', body: JSON.stringify({ recurring_id: u.recurring_id, expected_date: u.expected_date }),
            });
          } catch {}
          await load(days);
        },
      },
    ]);

  const active = patterns.filter(p => p.status === 'ACTIVE');
  const potential = patterns.filter(p => p.status === 'DETECTED');
  const inactive = patterns.filter(p => p.status === 'PAUSED' || p.status === 'ENDED');
  const monthlyTotal = active.reduce((sum, p) => {
    const perMonth: Record<string, number> = { WEEKLY: 52 / 12, FORTNIGHTLY: 26 / 12, MONTHLY: 1, QUARTERLY: 1 / 3, HALF_YEARLY: 1 / 6, YEARLY: 1 / 12 };
    return sum + p.expected_amount * (perMonth[p.frequency] || 0);
  }, 0);

  const Row = ({ p }: { p: Pattern }) => {
    const color = CATEGORY_COLORS[p.category] || theme.color.brand;
    return (
      <Pressable testID={`recurring-row-${p.merchant}`} onPress={() => setSheet(p)} style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: color + '22' }]}>
          <Ionicons name={CATEGORY_ICONS[p.category] || 'repeat'} size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{p.merchant}</Text>
          <Text style={styles.rowSub}>
            {amountText(p.expected_amount, p.amount_type)} / {PER[p.frequency]} • Next {fmtDate(p.next_date)}
          </Text>
        </View>
        {p.status === 'DETECTED' && <Text style={styles.badge}>{p.confidence}</Text>}
        {(p.status === 'PAUSED' || p.status === 'ENDED') && <Text style={styles.badge}>{p.status}</Text>}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="recurring-screen">
      <View style={styles.topBar}>
        <Pressable testID="recurring-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Upcoming & recurring</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && !summary ? (
        <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
          <View style={styles.tiles} testID="upcoming-summary">
            {([[7, 'next_7_days', 'count_7_days'], [30, 'next_30_days', 'count_30_days'], [90, 'next_90_days', 'count_90_days']] as const).map(([d, a, c]) => (
              <View key={d} style={styles.tile}>
                <Text style={styles.tileLabel}>Next {d} days</Text>
                <Text style={styles.tileAmt}>{formatINR(summary?.[a] || 0)}</Text>
                <Text style={styles.tileSub}>{summary?.[c] || 0} payment{(summary?.[c] || 0) === 1 ? '' : 's'}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>Estimates based on your past payments. Not a guarantee.</Text>

          <Text style={styles.section}>UPCOMING</Text>
          <View style={styles.chips}>
            {[7, 30, 90].map(d => (
              <Pressable key={d} testID={`upcoming-range-${d}`} onPress={() => setDays(d)} style={[styles.chip, days === d && styles.chipOn]}>
                <Text style={[styles.chipText, days === d && { color: '#fff' }]}>{d} days</Text>
              </Pressable>
            ))}
          </View>
          {upcoming.length === 0 ? (
            <Text style={styles.empty}>
              No upcoming payments yet. Once a payment repeats a few times it shows up here.
            </Text>
          ) : upcoming.map((u, i) => (
            <Pressable key={u.recurring_id + u.expected_date} testID={`upcoming-row-${i}`} onLongPress={() => skip(u)} onPress={() => skip(u)} style={styles.row}>
              <View style={styles.dateBox}>
                <Text style={styles.dateText}>{fmtDate(u.expected_date)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{u.merchant}</Text>
                <Text style={styles.rowSub}>
                  {u.status === 'MISSED' ? 'Not detected yet' : u.category}{u.account ? ` • ${u.account}` : ''}
                </Text>
              </View>
              <Text style={[styles.rowAmt, u.status === 'MISSED' && { color: theme.color.warning }]}>
                {amountText(u.expected_amount, u.amount_type)}
              </Text>
            </Pressable>
          ))}
          {upcoming.length > 0 && <Text style={styles.note}>Tap a payment to skip it once.</Text>}

          <Text style={styles.section}>
            ACTIVE{active.length ? ` • ~${formatINR(monthlyTotal)} / month` : ''}
          </Text>
          {active.length === 0 ? <Text style={styles.empty}>Confirm a detected payment below to track it.</Text> : active.map(p => <Row key={p.id} p={p} />)}

          {potential.length > 0 && (
            <>
              <Text style={styles.section}>POTENTIAL RECURRING</Text>
              {potential.map(p => <Row key={p.id} p={p} />)}
            </>
          )}
          {inactive.length > 0 && (
            <>
              <Text style={styles.section}>PAUSED / ENDED</Text>
              {inactive.map(p => <Row key={p.id} p={p} />)}
            </>
          )}
        </ScrollView>
      )}

      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)}>
          {sheet && (
            <Pressable style={styles.sheet} testID="recurring-sheet">
              <Text style={styles.sheetTitle}>{sheet.merchant}</Text>
              <Text style={styles.rowSub}>
                {amountText(sheet.expected_amount, sheet.amount_type)} / {PER[sheet.frequency]} • {sheet.category}
                {sheet.account ? ` • ${sheet.account}` : ''}
              </Text>
              {sheet.amount_type === 'VARIABLE' && (
                <Text style={styles.rowSub}>Usually {formatINR(sheet.amount_min)} – {formatINR(sheet.amount_max)}</Text>
              )}
              <Text style={[styles.section, { marginTop: theme.spacing.md }]}>RECENT PAYMENTS</Text>
              {sheet.history.slice(0, 4).map(h => (
                <View key={h.date} style={styles.histRow}>
                  <Text style={styles.rowSub}>{fmtDate(h.date)}</Text>
                  <Text style={styles.rowSub}>{formatINR(h.amount)}</Text>
                </View>
              ))}
              <View style={{ marginTop: theme.spacing.md, gap: 8 }}>
                {sheet.status === 'DETECTED' && <Btn id="confirm" label="Confirm recurring" primary onPress={() => act(sheet, 'confirm')} />}
                {sheet.status === 'ACTIVE' && <Btn id="pause" label="Pause tracking" onPress={() => act(sheet, 'pause')} />}
                {sheet.status === 'PAUSED' && <Btn id="resume" label="Resume tracking" primary onPress={() => act(sheet, 'resume')} />}
                {(sheet.status === 'ACTIVE' || sheet.status === 'PAUSED') && <Btn id="end" label="End recurring payment" onPress={() => act(sheet, 'end')} />}
                {sheet.status !== 'ENDED' && <Btn id="dismiss" label="Not recurring" danger onPress={() => act(sheet, 'dismiss')} />}
                <Btn id="close" label="Close" onPress={() => setSheet(null)} />
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Btn({ id, label, onPress, primary, danger }: { id: string; label: string; onPress: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <Pressable testID={`recurring-${id}`} onPress={onPress}
      style={[styles.btn, primary && { backgroundColor: theme.color.brand, borderColor: theme.color.brand }]}>
      <Text style={[styles.btnText, primary && { color: '#fff' }, danger && { color: theme.color.error }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.color.border },
  tileLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: '600' },
  tileAmt: { fontSize: 17, fontWeight: '700', color: theme.color.onSurface, marginTop: 4 },
  tileSub: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  note: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm },
  section: { fontSize: 11, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm },
  chips: { flexDirection: 'row', gap: 8, marginBottom: theme.spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surfaceSecondary },
  chipOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { fontSize: 13, color: theme.color.onSurface, fontWeight: '600' },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface },
  rowSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: '700', color: theme.color.onSurface },
  badge: { fontSize: 10, fontWeight: '700', color: theme.color.brand, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill, overflow: 'hidden' },
  dateBox: { width: 52, alignItems: 'center', paddingVertical: 6, borderRadius: theme.radius.sm, backgroundColor: theme.color.brandTertiary },
  dateText: { fontSize: 12, fontWeight: '700', color: theme.color.onBrandTertiary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, padding: theme.spacing.xl, paddingBottom: theme.spacing['2xl'] },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: theme.color.onSurface, marginBottom: 4 },
  histRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  btn: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface },
});
