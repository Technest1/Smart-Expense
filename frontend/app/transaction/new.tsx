import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme } from '@/src/theme';

const CATS = ['Food & Dining', 'Transport', 'Shopping', 'Groceries', 'Entertainment', 'Bills & Utilities', 'Health', 'Transfers', 'Uncategorized'];

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

type AccountOption = { value: string; label: string };

export default function AddManualTransaction() {
  const router = useRouter();
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('Uncategorized');
  const [date, setDate] = useState(todayISODate());
  const [account, setAccount] = useState<string | null>(null);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiFetch<{ items: { account: string; bank: string | null }[] }>('/accounts/balances');
        setAccountOptions((d.items || []).map(a => ({ value: a.account, label: a.bank ? `${a.bank} · ${a.account}` : a.account })));
      } catch {}
    })();
  }, []);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());
  const amountNum = parseFloat(amount);
  const canSubmit = merchant.trim().length > 0 && amountNum > 0 && dateValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await apiFetch('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountNum,
          direction,
          merchant: merchant.trim(),
          category,
          txn_date: `${date.trim()}T12:00:00`,
          account,
        }),
      });
      router.replace('/(tabs)/transactions');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="add-transaction-screen">
      <View style={styles.topBar}>
        <Pressable testID="add-txn-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Add transaction</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>

          <Text style={styles.label}>Type</Text>
          <View style={styles.segment}>
            <Pressable testID="dir-debit" onPress={() => setDirection('debit')} style={[styles.segItem, direction === 'debit' && styles.segItemActive]}>
              <Text style={[styles.segText, direction === 'debit' && styles.segTextActive]}>Money out</Text>
            </Pressable>
            <Pressable testID="dir-credit" onPress={() => setDirection('credit')} style={[styles.segItem, direction === 'credit' && styles.segItemActive]}>
              <Text style={[styles.segText, direction === 'credit' && styles.segTextActive]}>Money in</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Amount</Text>
          <TextInput
            testID="input-amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            keyboardType="decimal-pad"
            style={styles.input}
          />

          <Text style={styles.label}>Payee / merchant</Text>
          <TextInput
            testID="input-merchant"
            value={merchant}
            onChangeText={setMerchant}
            placeholder="e.g. Local grocery store"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
          />

          <Text style={styles.label}>Date</Text>
          <TextInput
            testID="input-date"
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={[styles.input, !dateValid && { borderColor: theme.color.error }]}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipWrap}>
            {CATS.map(c => (
              <Pressable key={c} testID={`new-cat-${c}`} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Account (optional)</Text>
          <View style={styles.chipWrap}>
            <Pressable testID="new-acct-none" onPress={() => setAccount(null)} style={[styles.chip, account === null && styles.chipActive]}>
              <Text style={[styles.chipText, account === null && styles.chipTextActive]}>None / Cash</Text>
            </Pressable>
            {accountOptions.map(a => (
              <Pressable key={a.value} testID={`new-acct-${a.value}`} onPress={() => setAccount(a.value)} style={[styles.chip, account === a.value && styles.chipActive]}>
                <Text style={[styles.chipText, account === a.value && styles.chipTextActive]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            testID="submit-new-txn"
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.primaryBtn, !canSubmit && { opacity: 0.5 }]}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save transaction</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  label: { fontSize: 12, fontWeight: '700', color: theme.color.onSurfaceTertiary, letterSpacing: 0.5, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: 15, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  segment: { flexDirection: 'row', backgroundColor: theme.color.surfaceTertiary, borderRadius: 10, padding: 4 },
  segItem: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segItemActive: { backgroundColor: theme.color.surfaceSecondary },
  segText: { color: theme.color.onSurfaceTertiary, fontWeight: '600', fontSize: 13 },
  segTextActive: { color: theme.color.onSurface },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { marginTop: theme.spacing['2xl'], backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
