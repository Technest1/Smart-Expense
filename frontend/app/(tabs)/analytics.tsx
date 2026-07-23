import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme, CATEGORY_COLORS, formatINR } from '@/src/theme';

type CatItem = { category: string; amount: number };
type Dash = { by_category: CatItem[]; month_spend: number };
type Trend = { series: { month: string; label: string; amount: number }[] };
type RecurItem = { merchant: string; category: string; avg_amount: number; months: number; last_seen: string };
type MerchItem = { merchant: string; category: string; total: number; count: number; avg: number };

const { width } = Dimensions.get('window');

export default function AnalyticsScreen() {
  const router = useRouter();
  const [dash, setDash] = useState<Dash | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [recurring, setRecurring] = useState<{ items: RecurItem[]; total_monthly: number } | null>(null);
  const [merchants, setMerchants] = useState<{ items: MerchItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, t, r, m] = await Promise.all([
        apiFetch<Dash>('/dashboard'),
        apiFetch<Trend>('/analytics/monthly-trend?months=6'),
        apiFetch<{ items: RecurItem[]; total_monthly: number }>('/analytics/recurring'),
        apiFetch<{ items: MerchItem[] }>('/analytics/by-merchant?range=month&limit=10'),
      ]);
      setDash(d); setTrend(t); setRecurring(r); setMerchants(m);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.color.brand} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="analytics-screen">
      <View style={styles.header}><Text style={styles.title}>Analytics</Text></View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}>

        <Section title="Spending by category">
          {(!dash?.by_category?.length) ? (
            <Text style={styles.empty}>No spending this month yet.</Text>
          ) : (
            <View style={styles.donutRow}>
              <DonutChart data={dash!.by_category} total={dash!.month_spend} />
              <View style={styles.legend}>
                {dash!.by_category.slice(0, 6).map(c => (
                  <View key={c.category} style={styles.legendRow}>
                    <View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[c.category] || theme.color.brand }]} />
                    <Text style={styles.legendCat} numberOfLines={1}>{c.category}</Text>
                    <Text style={styles.legendAmt}>{formatINR(c.amount)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </Section>

        <Section title="Last 6 months">
          <MonthlyBars data={trend?.series || []} />
        </Section>

        <Section title="Top merchants"
                subtitle={merchants?.items?.length ? 'This month' : undefined}>
          {(merchants?.items?.length || 0) === 0 ? (
            <Text style={styles.empty}>No merchant spending recorded for this month.</Text>
          ) : (
            <View>
              {merchants!.items.map((m, i) => {
                const top = merchants!.items[0]?.total || 1;
                const pct = Math.round((m.total / top) * 100);
                const color = CATEGORY_COLORS[m.category] || theme.color.brand;
                return (
                  <View key={m.merchant + i} style={[styles.merchRow, i > 0 && styles.rowBorder]} testID={`merch-row-${i}`}>
                    <View style={[styles.merchIcon, { backgroundColor: color + '22' }]}>
                      <Text style={styles.merchLetter}>{(m.merchant || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.merchTopLine}>
                        <Text style={styles.merchName} numberOfLines={1}>{m.merchant}</Text>
                        <Text style={styles.merchTotal}>{formatINR(m.total)}</Text>
                      </View>
                      <View style={styles.merchBarBg}>
                        <View style={[styles.merchBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                      <View style={styles.merchMeta}>
                        <Text style={styles.merchCat}>{m.category}</Text>
                        <Text style={styles.merchCount}>{m.count} txn{m.count > 1 ? 's' : ''} · avg {formatINR(m.avg)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Section>

        <Section title="Recurring subscriptions"
                subtitle={recurring?.items?.length ? `${recurring.items.length} detected • ~${formatINR(recurring.total_monthly)} / month` : undefined}>
          {(recurring?.items?.length || 0) === 0 ? (
            <Text style={styles.empty}>No recurring charges detected yet. Add a couple of months of transactions to see subscriptions.</Text>
          ) : (
            <View style={styles.recurCard}>
              {recurring!.items.map((r, i) => (
                <View key={r.merchant + i} style={[styles.recurRow, i > 0 && styles.rowBorder]}>
                  <View style={[styles.recurIcon, { backgroundColor: (CATEGORY_COLORS[r.category] || theme.color.brand) + '22' }]}>
                    <Ionicons name="repeat" size={16} color={CATEGORY_COLORS[r.category] || theme.color.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recurName} numberOfLines={1}>{r.merchant}</Text>
                    <Text style={styles.recurSub}>{r.category} • seen {r.months} months</Text>
                  </View>
                  <Text style={styles.recurAmt}>{formatINR(r.avg_amount)}</Text>
                </View>
              ))}
            </View>
          )}
        </Section>

        <Pressable
          testID="manage-budgets-btn"
          onPress={() => router.push('/budgets')}
          style={styles.cta}>
          <Ionicons name="pie-chart" size={18} color={theme.color.brand} />
          <Text style={styles.ctaText}>Manage budgets</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.color.brand} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: theme.spacing.xl }}>
      <View style={styles.secHeader}>
        <Text style={styles.secTitle}>{title}</Text>
        {subtitle ? <Text style={styles.secSub}>{subtitle}</Text> : null}
      </View>
      <View style={styles.secBody}>{children}</View>
    </View>
  );
}

function DonutChart({ data, total }: { data: CatItem[]; total: number }) {
  const size = 140;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const sum = total || data.reduce((s, x) => s + x.amount, 0);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G rotation={-90} originX={size / 2} originY={size / 2}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.color.surfaceTertiary} strokeWidth={stroke} fill="none" />
        {data.map((d, i) => {
          const pct = sum ? d.amount / sum : 0;
          const len = pct * c;
          const el = (
            <Circle
              key={d.category + i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={CATEGORY_COLORS[d.category] || theme.color.brand}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              fill="none"
            />
          );
          offset += len;
          return el;
        })}
      </G>
      <SvgText x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="10" fill={theme.color.onSurfaceTertiary}>SPENT</SvgText>
      <SvgText x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="16" fontWeight="700" fill={theme.color.onSurface}>{formatINR(sum)}</SvgText>
    </Svg>
  );
}

function MonthlyBars({ data }: { data: { label: string; amount: number }[] }) {
  const barW = 32;
  const gap = 14;
  const chartH = 160;
  const w = data.length * (barW + gap) + gap;
  const max = Math.max(1, ...data.map(d => d.amount));
  return (
    <View style={{ paddingHorizontal: theme.spacing.md }}>
      <Svg width={Math.max(width - 64, w)} height={chartH + 30} viewBox={`0 0 ${Math.max(width - 64, w)} ${chartH + 30}`}>
        {data.map((d, i) => {
          const h = (d.amount / max) * chartH;
          const x = i * (barW + gap) + gap;
          const y = chartH - h;
          return (
            <G key={i}>
              <Rect x={x} y={y} width={barW} height={Math.max(h, 2)} rx={6} fill={i === data.length - 1 ? theme.color.brand : theme.color.brandSecondary} />
              <SvgText x={x + barW / 2} y={chartH + 14} textAnchor="middle" fontSize="10" fill={theme.color.onSurfaceTertiary}>{d.label}</SvgText>
              {d.amount > 0 && (
                <SvgText x={x + barW / 2} y={Math.max(y - 4, 10)} textAnchor="middle" fontSize="9" fill={theme.color.onSurfaceSecondary}>
                  {d.amount >= 1000 ? `${Math.round(d.amount / 1000)}k` : Math.round(d.amount)}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: theme.color.onSurface },
  secHeader: { paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.sm },
  secTitle: { fontSize: 14, fontWeight: '700', color: theme.color.onSurfaceSecondary },
  secSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  secBody: { marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  donutRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendCat: { flex: 1, fontSize: 13, color: theme.color.onSurface },
  legendAmt: { fontSize: 13, fontWeight: '700', color: theme.color.onSurface },
  empty: { color: theme.color.onSurfaceTertiary, fontSize: 13, textAlign: 'center', padding: theme.spacing.md },
  recurCard: {},
  recurRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: theme.spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.divider },
  recurIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  recurName: { fontSize: 14, fontWeight: '600', color: theme.color.onSurface },
  recurSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  recurAmt: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface },
  cta: { marginTop: theme.spacing.xl, marginHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.color.brandTertiary, padding: theme.spacing.md, borderRadius: theme.radius.md },
  ctaText: { flex: 1, color: theme.color.brand, fontWeight: '700', fontSize: 14 },
  merchRow: { flexDirection: 'row', gap: 12, paddingVertical: theme.spacing.sm },
  merchIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  merchLetter: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface },
  merchTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  merchName: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.color.onSurface },
  merchTotal: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface },
  merchBarBg: { height: 4, backgroundColor: theme.color.surfaceTertiary, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  merchBarFill: { height: 4, borderRadius: 2 },
  merchMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  merchCat: { fontSize: 11, color: theme.color.onSurfaceTertiary },
  merchCount: { fontSize: 11, color: theme.color.onSurfaceTertiary },
});
