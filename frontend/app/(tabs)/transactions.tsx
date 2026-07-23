import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme, CATEGORY_COLORS, CATEGORY_ICONS, formatINR } from '@/src/theme';

type Txn = {
  id: string; amount: number; direction: 'debit' | 'credit'; merchant: string;
  category: string; txn_date: string; source: string; is_duplicate: boolean;
};

const CATS = ['All', 'Food & Dining', 'Transport', 'Shopping', 'Groceries', 'Entertainment', 'Bills & Utilities', 'Health', 'Transfers', 'Uncategorized'];
const SOURCES = ['All', 'sms', 'email', 'manual'];

export default function TransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [items, setItems] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cat, setCat] = useState('All');
  const [src, setSrc] = useState('All');
  const [showDupsOnly, setShowDupsOnly] = useState(params.filter === 'duplicates');

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (cat !== 'All') q.set('category', cat);
      if (src !== 'All') q.set('source', src);
      q.set('include_duplicates', 'true');
      const d = await apiFetch<{ items: Txn[] }>(`/transactions?${q.toString()}`);
      setItems(d.items || []);
    } catch {}
  }, [cat, src]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => showDupsOnly ? items.filter(t => t.is_duplicate) : items, [items, showDupsOnly]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="transactions-screen">
      <View style={styles.stickyHeader}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Transactions</Text>
          <Pressable
            testID="dup-filter-toggle"
            onPress={() => setShowDupsOnly(v => !v)}
            style={[styles.dupToggle, showDupsOnly && styles.dupToggleActive]}>
            <Ionicons name="alert-circle-outline" size={16} color={showDupsOnly ? '#fff' : theme.color.warning} />
            <Text style={[styles.dupToggleText, showDupsOnly && { color: '#fff' }]}>Duplicates</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}>
          {CATS.map(c => (
            <Pressable
              key={c}
              testID={`cat-chip-${c}`}
              onPress={() => setCat(c)}
              style={[styles.chip, cat === c && styles.chipActive]}>
              <Text style={[styles.chipText, cat === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}>
          {SOURCES.map(s => (
            <Pressable
              key={s}
              testID={`src-chip-${s}`}
              onPress={() => setSrc(s)}
              style={[styles.chip, src === s && styles.chipActive]}>
              <Text style={[styles.chipText, src === s && styles.chipTextActive]}>
                {s === 'All' ? 'All sources' : s.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="file-tray-outline" size={40} color={theme.color.onSurfaceTertiary} />
          <Text style={styles.emptyText}>No transactions match these filters</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brand} />}
          renderItem={({ item, index }) => {
            const color = CATEGORY_COLORS[item.category] || theme.color.brand;
            return (
              <Pressable
                testID={`txn-row-${item.id}`}
                onPress={() => router.push(`/transaction/${item.id}`)}
                style={[styles.row, index === 0 && { marginTop: theme.spacing.md }]}>
                <View style={[styles.icon, { backgroundColor: color + '22' }]}>
                  <Ionicons name={CATEGORY_ICONS[item.category] || 'ellipsis-horizontal-outline'} size={18} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.merchant} numberOfLines={1}>{item.merchant}</Text>
                    {item.is_duplicate && (
                      <View style={styles.dupBadge}>
                        <Text style={styles.dupBadgeText}>DUP</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.meta}>{item.category} • {new Date(item.txn_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} • {item.source.toUpperCase()}</Text>
                </View>
                <Text style={[styles.amount, { color: item.direction === 'credit' ? theme.color.success : theme.color.onSurface }]}>
                  {item.direction === 'credit' ? '+' : '-'}{formatINR(item.amount)}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  stickyHeader: { backgroundColor: theme.color.surface, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: theme.color.onSurface },
  dupToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FDF6E6', borderColor: '#F3E1B2', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  dupToggleActive: { backgroundColor: theme.color.warning, borderColor: theme.color.warning },
  dupToggleText: { fontSize: 12, fontWeight: '700', color: theme.color.warning },
  chipRow: { height: 56 },
  chipRowContent: { paddingHorizontal: theme.spacing.lg, alignItems: 'center', gap: 8 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: theme.color.onSurfaceTertiary, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.md, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  merchant: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface, flexShrink: 1 },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700' },
  dupBadge: { backgroundColor: theme.color.warning, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  dupBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
