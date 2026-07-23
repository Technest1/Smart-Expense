import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
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
  month_spend: number; month_income: number;
  by_category: { category: string; amount: number }[];
  duplicate_count: number; recent: Txn[]; total_transactions: number;
};

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<Dash>('/dashboard');
      setData(d);
    } catch (e) {
      // ignore
    }
  }, []);

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

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}><ActivityIndicator color={theme.color.brand} /></SafeAreaView>
    );
  }

  const catTotal = (data?.by_category || []).reduce((s, x) => s + x.amount, 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}>

        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.headerSub}>This month at a glance</Text>
          </View>
          <Pressable
            testID="import-nav-button"
            onPress={() => router.push('/import')}
            style={styles.iconBtn}>
            <Ionicons name="add" size={22} color={theme.color.onSurface} />
          </Pressable>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>SPENT THIS MONTH</Text>
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
});
