import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme, CATEGORY_COLORS, CATEGORY_ICONS, formatINR } from '@/src/theme';

type Txn = {
  id: string; amount: number; direction: 'debit' | 'credit'; merchant: string;
  category: string; txn_date: string; source: string; is_duplicate: boolean;
  duplicate_of?: string | null; raw_text: string; ref_id?: string | null;
  account?: string | null; parser: string;
};

const CATS = ['Food & Dining', 'Transport', 'Shopping', 'Groceries', 'Entertainment', 'Bills & Utilities', 'Health', 'Transfers', 'Uncategorized'];

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [txn, setTxn] = useState<Txn | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try {
      const t = await apiFetch<Txn>(`/transactions/${id}`);
      setTxn(t);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const changeCategory = async (cat: string) => {
    if (!txn) return;
    const updated = await apiFetch<Txn>(`/transactions/${txn.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category: cat }),
    });
    setTxn(updated);
    setEditing(false);
  };

  const doDelete = () => {
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await apiFetch(`/transactions/${id}`, { method: 'DELETE' });
          router.back();
        },
      },
    ]);
  };

  const toggleDuplicate = async () => {
    if (!txn) return;
    const updated = await apiFetch<Txn>(`/transactions/${txn.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_duplicate: !txn.is_duplicate }),
    });
    setTxn(updated);
  };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.color.brand} /></SafeAreaView>;
  if (!txn) return <SafeAreaView style={styles.center}><Text>Not found</Text></SafeAreaView>;

  const color = CATEGORY_COLORS[txn.category] || theme.color.brand;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="txn-detail-screen">
      <View style={styles.topBar}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Transaction</Text>
        <Pressable testID="delete-button" onPress={doDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={20} color={theme.color.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: color + '22' }]}>
            <Ionicons name={CATEGORY_ICONS[txn.category] || 'ellipsis-horizontal-outline'} size={26} color={color} />
          </View>
          <Text style={styles.merchant}>{txn.merchant}</Text>
          <Text style={[styles.amount, { color: txn.direction === 'credit' ? theme.color.success : theme.color.onSurface }]}>
            {txn.direction === 'credit' ? '+' : '-'}{formatINR(txn.amount)}
          </Text>
          <Text style={styles.date}>{new Date(txn.txn_date).toLocaleString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</Text>
        </View>

        {txn.is_duplicate && (
          <View style={styles.dupCard}>
            <Ionicons name="alert-circle" size={20} color={theme.color.warning} />
            <Text style={styles.dupText}>Marked as possible duplicate</Text>
          </View>
        )}

        <View style={styles.card}>
          <Row label="Category">
            <Pressable
              testID="edit-category-btn"
              onPress={() => setEditing(v => !v)}
              style={styles.catPill}>
              <View style={[styles.catDot, { backgroundColor: color }]} />
              <Text style={styles.catText}>{txn.category}</Text>
              <Ionicons name="chevron-down" size={14} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          </Row>
          {editing && (
            <View style={styles.catList} testID="category-picker">
              {CATS.map(c => (
                <Pressable
                  key={c}
                  testID={`pick-cat-${c}`}
                  onPress={() => changeCategory(c)}
                  style={[styles.catOption, c === txn.category && styles.catOptionActive]}>
                  <View style={[styles.catDot, { backgroundColor: CATEGORY_COLORS[c] || theme.color.brand }]} />
                  <Text style={styles.catOptionText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.divider} />
          <Row label="Source"><Text style={styles.value}>{txn.source.toUpperCase()}</Text></Row>
          <View style={styles.divider} />
          <Row label="Type"><Text style={styles.value}>{txn.direction === 'credit' ? 'Money in' : 'Money out'}</Text></Row>
          {txn.account ? (<><View style={styles.divider} /><Row label="Account"><Text style={styles.value}>{txn.account}</Text></Row></>) : null}
          {txn.ref_id ? (<><View style={styles.divider} /><Row label="Reference"><Text style={[styles.value, { fontSize: 12 }]}>{txn.ref_id}</Text></Row></>) : null}
          <View style={styles.divider} />
          <Row label="Parsed by"><Text style={styles.value}>{txn.parser === 'ai' ? 'AI (Claude)' : txn.parser === 'regex' ? 'Regex' : 'Manual'}</Text></Row>
        </View>

        <Text style={styles.sectionLabel}>ORIGINAL MESSAGE</Text>
        <View style={styles.rawBox}>
          <Text style={styles.rawText} testID="raw-text">{txn.raw_text}</Text>
        </View>

        <Pressable
          testID="toggle-duplicate-btn"
          onPress={toggleDuplicate}
          style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>
            {txn.is_duplicate ? 'Un-mark as duplicate' : 'Mark as duplicate'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flexShrink: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  hero: { alignItems: 'center', paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xl },
  heroIcon: { width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  merchant: { fontSize: 20, fontWeight: '700', color: theme.color.onSurface },
  amount: { fontSize: 36, fontWeight: '700', marginTop: theme.spacing.xs, letterSpacing: -1 },
  date: { color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.xs, fontSize: 13 },
  dupCard: { marginHorizontal: theme.spacing.lg, backgroundColor: '#FDF6E6', borderColor: '#F3E1B2', borderWidth: 1, borderRadius: theme.radius.md, padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.spacing.md },
  dupText: { color: theme.color.warning, fontWeight: '700', fontSize: 13 },
  card: { marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md, gap: 12 },
  rowLabel: { fontSize: 13, color: theme.color.onSurfaceTertiary, fontWeight: '600' },
  value: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.color.divider },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.color.surfaceTertiary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catText: { fontSize: 13, color: theme.color.onSurface, fontWeight: '600' },
  catList: { paddingBottom: theme.spacing.md },
  catOption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 },
  catOptionActive: { backgroundColor: theme.color.brandTertiary },
  catOptionText: { fontSize: 14, color: theme.color.onSurface },
  sectionLabel: { fontSize: 11, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm },
  rawBox: { marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceTertiary, padding: theme.spacing.md, borderRadius: theme.radius.md },
  rawText: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 20, fontFamily: 'Courier' },
  secondaryBtn: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg, borderColor: theme.color.borderStrong, borderWidth: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center' },
  secondaryBtnText: { color: theme.color.onSurface, fontWeight: '600', fontSize: 14 },
});
