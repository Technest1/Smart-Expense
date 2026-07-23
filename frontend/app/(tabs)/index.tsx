import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme, CATEGORY_COLORS, CATEGORY_ICONS, formatINR } from '@/src/theme';
import { useAuth } from '@/src/contexts/AuthContext';

type Txn = {
  id: string; amount: number; direction: 'debit' | 'credit'; merchant: string;
  category: string; txn_date: string; source: string; is_duplicate: boolean;
};
type Dash = {
  range?: { key: string; label: string; start: string; end: string };
  month_spend: number; month_income: number;
  by_category: { category: string; amount: number }[];
  duplicate_count: number; recent: Txn[]; total_transactions: number;
  budgets?: { id: string; category: string; monthly_limit: number; spent: number; pct: number; over_budget: boolean; near_limit: boolean }[];
  recurring_count?: number;
};
type AccountBalance = { account: string; balance: number; as_of: string };

const RANGES: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dash | null>(null);
  const [accounts, setAccounts] = useState<{ items: AccountBalance[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [rangeKey, setRangeKey] = useState<string>('month');
  const [customModal, setCustomModal] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customApplied, setCustomApplied] = useState<{ start: string; end: string } | null>(null);

  const load = useCallback(async () => {
    try {
      let url = `/dashboard?range=${rangeKey}`;
      if (rangeKey === 'custom' && customApplied) {
        url += `&start=${encodeURIComponent(customApplied.start)}&end=${encodeURIComponent(customApplied.end)}`;
      }
      const [d, a] = await Promise.all([
        apiFetch<Dash>(url),
        apiFetch<{ items: AccountBalance[]; total: number }>('/accounts/balances'),
      ]);
      setData(d);
      setAccounts(a);
    } catch (e) {
      // ignore
    }
  }, [rangeKey, customApplied]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const seedSample = async () => {
    setSeeding(true);
    try {
      await apiFetch('/messages/seed-sample', { method: 'POST' });
      await load();
    } finally {
      setSeeding(false);
    }
  };

  const applyCustom = () => {
    // Accept yyyy-mm-dd, convert to ISO datetimes.
    const s = customStart.trim();
    const e = customEnd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return;
    setCustomApplied({ start: `${s}T00:00:00`, end: `${e}T23:59:59` });
    setRangeKey('custom');
    setCustomModal(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}><ActivityIndicator color={theme.color.brand} /></SafeAreaView>
    );
  }

  const catTotal = (data?.by_category || []).reduce((s, x) => s + x.amount, 0);
  const currentLabel = data?.range?.label || 'This month';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}>

        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.headerSub}>{currentLabel} at a glance</Text>
          </View>
          <Pressable
            testID="import-nav-button"
            onPress={() => router.push('/import')}
            style={styles.iconBtn}>
            <Ionicons name="add" size={22} color={theme.color.onSurface} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.rangeRow}
          contentContainerStyle={styles.rangeRowContent}>
          {RANGES.map(r => (
            <Pressable
              key={r.key}
              testID={`range-chip-${r.key}`}
              onPress={() => {
                if (r.key === 'custom') { setCustomModal(true); }
                else { setRangeKey(r.key); setCustomApplied(null); }
              }}
              style={[styles.rangeChip, rangeKey === r.key && styles.rangeChipActive]}>
              <Text style={[styles.rangeChipText, rangeKey === r.key && styles.rangeChipTextActive]}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>SPENT · {(currentLabel || '').toUpperCase()}</Text>
          <Text style={styles.balanceAmount} testID="month-spend">
            {formatINR(data?.month_spend || 0)}
          </Text>
          <View style={styles.balanceRow}>
            <View style={styles.balancePill}>
              <Ionicons name="arrow-down" size={14} color={theme.color.success} />
              <Text style={styles.pillText}>Income {formatINR(data?.month_income || 0)}</Text>
            </View>
            <View style={styles.balancePill}>
              <Ionicons name="receipt-outline" size={14} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.pillText}>{data?.total_transactions || 0} txns</Text>
            </View>
          </View>
        </View>

        {(accounts?.items?.length || 0) > 0 && (
          <View style={styles.acctSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Account balances</Text>
              <Text style={styles.link}>Total {formatINR(accounts?.total || 0)}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.acctRow}>
              {accounts!.items.map(a => (
                <View key={a.account} style={styles.acctCard} testID={`acct-card-${a.account}`}>
                  <View style={styles.acctIcon}>
                    <Ionicons name="wallet-outline" size={18} color={theme.color.brand} />
                  </View>
                  <Text style={styles.acctName}>Acct {a.account}</Text>
                  <Text style={styles.acctBalance}>{formatINR(a.balance)}</Text>
                  <Text style={styles.acctMeta}>
                    as of {new Date(a.as_of).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {(data?.duplicate_count || 0) > 0 && (
          <Pressable
            testID="duplicate-banner"
            onPress={() => router.push('/(tabs)/transactions?filter=duplicates')}
            style={styles.dupBanner}>
            <View style={styles.dupIcon}>
              <Ionicons name="alert-circle" size={20} color={theme.color.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dupTitle}>{data?.duplicate_count} possible duplicate{(data?.duplicate_count || 0) > 1 ? 's' : ''} found</Text>
              <Text style={styles.dupSub}>Review to clean up your transactions</Text>
            </View>
            <Text style={styles.dupCta}>Review</Text>
          </Pressable>
        )}

        {(data?.budgets || []).filter(b => b.over_budget || b.near_limit).slice(0, 2).map(b => (
          <Pressable
            key={b.id}
            testID={`budget-alert-${b.category}`}
            onPress={() => router.push('/budgets')}
            style={[styles.dupBanner, b.over_budget && { backgroundColor: '#FBE9E9', borderColor: '#F1CFCF' }]}>
            <View style={[styles.dupIcon, b.over_budget && { backgroundColor: '#F5D6D6' }]}>
              <Ionicons name={b.over_budget ? 'flame' : 'trending-up'} size={18} color={b.over_budget ? theme.color.error : theme.color.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dupTitle}>
                {b.category} — {b.over_budget ? 'over budget' : 'close to limit'}
              </Text>
              <Text style={styles.dupSub}>
                {formatINR(b.spent)} of {formatINR(b.monthly_limit)} ({Math.round(b.pct)}%)
              </Text>
            </View>
            <Text style={[styles.dupCta, b.over_budget && { color: theme.color.error }]}>Adjust</Text>
          </Pressable>
        ))}

        {(data?.recurring_count || 0) > 0 && (
          <Pressable
            testID="recurring-card"
            onPress={() => router.push('/(tabs)/analytics')}
            style={styles.recurCard}>
            <View style={styles.recurIconWrap}>
              <Ionicons name="repeat" size={18} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dupTitle}>{data?.recurring_count} recurring subscription{(data?.recurring_count || 0) > 1 ? 's' : ''}</Text>
              <Text style={styles.dupSub}>Tap to review your monthly commitments</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.color.brand} />
          </Pressable>
        )}

        {(data?.total_transactions || 0) === 0 ? (
          <View style={styles.empty} testID="empty-state">
            <View style={styles.emptyIcon}>
              <Ionicons name="wallet-outline" size={40} color={theme.color.brand} />
            </View>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptySub}>
              Import your bank SMS or emails to start tracking. Or load sample data to explore.
            </Text>
            <Pressable
              testID="seed-sample-button"
              onPress={seedSample}
              disabled={seeding}
              style={styles.primaryBtn}>
              {seeding ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Load sample data</Text>}
            </Pressable>
            <Pressable
              testID="import-empty-button"
              onPress={() => router.push('/import')}
              style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Paste real messages</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>By category</Text>
            </View>
            <View style={styles.card}>
              {(data?.by_category || []).slice(0, 6).map((c, i) => {
                const pct = catTotal ? Math.round((c.amount / catTotal) * 100) : 0;
                const color = CATEGORY_COLORS[c.category] || theme.color.brand;
                return (
                  <View key={c.category} style={[styles.catRow, i > 0 && styles.rowBorder]}>
                    <View style={[styles.catDot, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.catName}>{c.category}</Text>
                      <View style={styles.catBarBg}>
                        <View style={[styles.catBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                    </View>
                    <Text style={styles.catAmount}>{formatINR(c.amount)}</Text>
                  </View>
                );
              })}
              {(data?.by_category || []).length === 0 && (
                <Text style={styles.muted}>No spending this month yet.</Text>
              )}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent transactions</Text>
              <Pressable testID="see-all-txns" onPress={() => router.push('/(tabs)/transactions')}>
                <Text style={styles.link}>See all</Text>
              </Pressable>
            </View>
            <View style={styles.card}>
              {(data?.recent || []).map((t, i) => (
                <Pressable
                  key={t.id}
                  testID={`recent-txn-${t.id}`}
                  onPress={() => router.push(`/transaction/${t.id}`)}
                  style={[styles.txnRow, i > 0 && styles.rowBorder]}>
                  <View style={[styles.txnIcon, { backgroundColor: (CATEGORY_COLORS[t.category] || theme.color.brand) + '22' }]}>
                    <Ionicons
                      name={CATEGORY_ICONS[t.category] || 'ellipsis-horizontal-outline'}
                      size={18}
                      color={CATEGORY_COLORS[t.category] || theme.color.brand}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnMerchant} numberOfLines={1}>{t.merchant}</Text>
                    <Text style={styles.txnMeta}>{t.category} • {new Date(t.txn_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</Text>
                  </View>
                  <Text style={[styles.txnAmount, { color: t.direction === 'credit' ? theme.color.success : theme.color.onSurface }]}>
                    {t.direction === 'credit' ? '+' : '-'}{formatINR(t.amount)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={customModal} transparent animationType="fade" onRequestClose={() => setCustomModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard} testID="custom-range-modal">
            <Text style={styles.modalTitle}>Custom date range</Text>
            <Text style={styles.modalSub}>Enter dates in YYYY-MM-DD format</Text>
            <Text style={styles.modalLabel}>Start date</Text>
            <TextInput
              testID="custom-start-input"
              value={customStart}
              onChangeText={setCustomStart}
              placeholder="2026-01-01"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.modalInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalLabel}>End date</Text>
            <TextInput
              testID="custom-end-input"
              value={customEnd}
              onChangeText={setCustomEnd}
              placeholder="2026-01-31"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.modalInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <Pressable testID="custom-cancel" onPress={() => setCustomModal(false)} style={styles.modalSecondary}>
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable testID="custom-apply" onPress={applyCustom} style={styles.modalPrimary}>
                <Text style={styles.modalPrimaryText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md },
  hello: { fontSize: 22, fontWeight: '700', color: theme.color.onSurface },
  headerSub: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  balanceCard: {
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.color.surfaceInverse,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
  },
  balanceLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  balanceAmount: { color: '#fff', fontSize: 40, fontWeight: '700', marginTop: theme.spacing.sm, letterSpacing: -1 },
  balanceRow: { flexDirection: 'row', gap: 8, marginTop: theme.spacing.lg, flexWrap: 'wrap' },
  balancePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  dupBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md,
    backgroundColor: '#FDF6E6', borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: 1, borderColor: '#F3E1B2',
  },
  dupIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F7ECC7', alignItems: 'center', justifyContent: 'center' },
  dupTitle: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface },
  dupSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  dupCta: { color: theme.color.brand, fontWeight: '700', fontSize: 13 },
  recurCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md,
    backgroundColor: theme.color.brandTertiary, borderRadius: theme.radius.md, padding: theme.spacing.md,
  },
  recurIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#D2DED6', alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: theme.color.onSurfaceSecondary },
  link: { color: theme.color.brand, fontSize: 13, fontWeight: '600' },
  card: { marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: theme.spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.divider },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catName: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  catBarBg: { height: 4, backgroundColor: theme.color.surfaceTertiary, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  catBarFill: { height: 4, borderRadius: 2 },
  catAmount: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface },
  txnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: theme.spacing.md },
  txnIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  txnMerchant: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface },
  txnMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  txnAmount: { fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing['3xl'] },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: theme.color.onSurface },
  emptySub: { fontSize: 14, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 20 },
  primaryBtn: { marginTop: theme.spacing.xl, backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.xl, paddingVertical: 14, borderRadius: theme.radius.md, minWidth: 220, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { marginTop: theme.spacing.md, paddingHorizontal: theme.spacing.xl, paddingVertical: 12 },
  secondaryBtnText: { color: theme.color.brand, fontWeight: '600', fontSize: 14 },
  muted: { color: theme.color.onSurfaceTertiary, textAlign: 'center', padding: theme.spacing.lg, fontSize: 13 },
  rangeRow: { paddingBottom: theme.spacing.md, marginBottom: theme.spacing.sm },
  rangeRowContent: { paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: 'center' },
  rangeChip: { height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rangeChipActive: { backgroundColor: theme.color.surfaceInverse, borderColor: theme.color.surfaceInverse },
  rangeChipText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  rangeChipTextActive: { color: '#fff' },
  acctSection: { marginTop: theme.spacing.xl },
  acctRow: { paddingHorizontal: theme.spacing.lg, gap: 10 },
  acctCard: { width: 160, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.color.border },
  acctIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.sm },
  acctName: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: '600' },
  acctBalance: { fontSize: 18, fontWeight: '700', color: theme.color.onSurface, marginTop: 2 },
  acctMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 380 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.color.onSurface },
  modalSub: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.xs },
  modalLabel: { fontSize: 12, letterSpacing: 0.5, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginTop: theme.spacing.md, textTransform: 'uppercase' },
  modalInput: { backgroundColor: theme.color.surfaceTertiary, padding: theme.spacing.md, borderRadius: theme.radius.md, fontSize: 15, color: theme.color.onSurface, marginTop: theme.spacing.xs },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: theme.spacing.lg },
  modalSecondary: { paddingHorizontal: theme.spacing.lg, paddingVertical: 12, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceTertiary },
  modalSecondaryText: { color: theme.color.onSurface, fontWeight: '600' },
  modalPrimary: { paddingHorizontal: theme.spacing.lg, paddingVertical: 12, borderRadius: theme.radius.md, backgroundColor: theme.color.brand },
  modalPrimaryText: { color: '#fff', fontWeight: '700' },
});
