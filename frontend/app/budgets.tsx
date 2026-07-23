import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme, CATEGORY_COLORS, CATEGORY_ICONS, formatINR } from '@/src/theme';

type Budget = {
  id: string; category: string; monthly_limit: number;
  spent?: number; pct?: number; over_budget?: boolean; near_limit?: boolean;
};

const CATS = ['Food & Dining', 'Transport', 'Shopping', 'Groceries', 'Entertainment', 'Bills & Utilities', 'Health', 'Transfers', 'Uncategorized'];

export default function BudgetsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [chosenCat, setChosenCat] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<{ budgets: Budget[] }>('/dashboard');
      setItems(d.budgets || []);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  const save = async () => {
    if (!chosenCat || !amount) return;
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    setSaving(true);
    try {
      await apiFetch('/budgets', {
        method: 'POST',
        body: JSON.stringify({ category: chosenCat, monthly_limit: n }),
      });
      setChosenCat(null); setAmount(''); setShowAdd(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => {
    Alert.alert('Delete budget?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await apiFetch(`/budgets/${id}`, { method: 'DELETE' });
          await load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="budgets-screen">
      <View style={styles.topBar}>
        <Pressable testID="budgets-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Budgets</Text>
        <Pressable testID="add-budget-btn" onPress={() => setShowAdd(v => !v)} style={styles.iconBtn}>
          <Ionicons name={showAdd ? 'close' : 'add'} size={22} color={theme.color.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {showAdd && (
          <View style={styles.addCard} testID="add-budget-card">
            <Text style={styles.addTitle}>Set a monthly limit</Text>
            <Text style={styles.addSub}>Pick a category</Text>
            <View style={styles.catGrid}>
              {CATS.map(c => (
                <Pressable
                  key={c}
                  testID={`budget-cat-${c}`}
                  onPress={() => setChosenCat(c)}
                  style={[styles.catChip, chosenCat === c && styles.catChipActive]}>
                  <Ionicons
                    name={CATEGORY_ICONS[c] || 'ellipsis-horizontal-outline'}
                    size={14}
                    color={chosenCat === c ? '#fff' : (CATEGORY_COLORS[c] || theme.color.brand)}
                  />
                  <Text style={[styles.catChipText, chosenCat === c && { color: '#fff' }]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.addSub, { marginTop: theme.spacing.md }]}>Amount (₹)</Text>
            <TextInput
              testID="budget-amount-input"
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 5000"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              keyboardType="numeric"
              style={styles.input}
            />
            <Pressable
              testID="save-budget-btn"
              onPress={save}
              disabled={!chosenCat || !amount || saving}
              style={[styles.primaryBtn, (!chosenCat || !amount || saving) && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save budget</Text>}
            </Pressable>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="pie-chart-outline" size={36} color={theme.color.brand} />
            </View>
            <Text style={styles.emptyTitle}>No budgets set</Text>
            <Text style={styles.emptySub}>Set a monthly cap for a category to get alerts when you cross 80%.</Text>
            {!showAdd && (
              <Pressable testID="empty-add-budget" onPress={() => setShowAdd(true)} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Add your first budget</Text>
              </Pressable>
            )}
          </View>
        ) : (
          items.map(b => {
            const color = CATEGORY_COLORS[b.category] || theme.color.brand;
            const pct = Math.min(b.pct || 0, 100);
            const status = b.over_budget ? 'Over budget' : b.near_limit ? 'Close to limit' : 'On track';
            const statusColor = b.over_budget ? theme.color.error : b.near_limit ? theme.color.warning : theme.color.success;
            return (
              <View key={b.id} style={styles.budgetCard} testID={`budget-row-${b.category}`}>
                <View style={styles.budgetHead}>
                  <View style={[styles.budgetIcon, { backgroundColor: color + '22' }]}>
                    <Ionicons name={CATEGORY_ICONS[b.category] || 'ellipsis-horizontal-outline'} size={18} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.budgetCat}>{b.category}</Text>
                    <Text style={[styles.budgetStatus, { color: statusColor }]}>{status}</Text>
                  </View>
                  <Pressable testID={`delete-budget-${b.category}`} onPress={() => remove(b.id)} style={styles.iconBtnSmall}>
                    <Ionicons name="trash-outline" size={16} color={theme.color.error} />
                  </Pressable>
                </View>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: b.over_budget ? theme.color.error : color }]} />
                </View>
                <View style={styles.budgetFoot}>
                  <Text style={styles.budgetAmt}>{formatINR(b.spent || 0)} <Text style={styles.budgetMuted}>of {formatINR(b.monthly_limit)}</Text></Text>
                  <Text style={styles.budgetPct}>{Math.round(pct)}%</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  iconBtnSmall: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  addCard: { marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginTop: theme.spacing.sm },
  addTitle: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  addSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  catChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  catChipText: { fontSize: 12, fontWeight: '600', color: theme.color.onSurfaceSecondary },
  input: { backgroundColor: theme.color.surfaceTertiary, padding: theme.spacing.md, borderRadius: theme.radius.md, fontSize: 16, color: theme.color.onSurface },
  primaryBtn: { marginTop: theme.spacing.lg, backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { alignItems: 'center', paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing['3xl'] },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.color.onSurface },
  emptySub: { fontSize: 13, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginTop: theme.spacing.xs, lineHeight: 20 },
  budgetCard: { marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.md },
  budgetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  budgetIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  budgetCat: { fontSize: 15, fontWeight: '700', color: theme.color.onSurface },
  budgetStatus: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  barBg: { height: 8, backgroundColor: theme.color.surfaceTertiary, borderRadius: 4, marginTop: theme.spacing.md, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  budgetFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.spacing.sm },
  budgetAmt: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  budgetMuted: { color: theme.color.onSurfaceTertiary, fontWeight: '500' },
  budgetPct: { fontSize: 14, fontWeight: '700', color: theme.color.onSurfaceSecondary },
});
