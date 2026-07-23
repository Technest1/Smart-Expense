import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '@/src/api/client';
import { theme } from '@/src/theme';

type Source = 'sms' | 'email';

export default function ImportScreen() {
  const router = useRouter();
  const [source, setSource] = useState<Source>('sms');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ saved: number; duplicates: number; skipped: number } | null>(null);

  const doImport = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      // Split by double-newline to support pasting multiple messages at once
      const blocks = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
      const items = blocks.map(b => ({ source, text: b }));
      const r = await apiFetch<{ saved: number; duplicates: number; skipped: number }>('/messages/ingest', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      setResult(r);
      setText('');
    } catch (e: any) {
      setResult({ saved: 0, duplicates: 0, skipped: 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="import-screen">
      <View style={styles.topBar}>
        <Pressable testID="import-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Import messages</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
          <Text style={styles.hint}>
            Paste one or more bank SMS or emails below. Separate multiple messages with a blank line.
          </Text>

          <View style={styles.segment}>
            <Pressable
              testID="src-sms"
              onPress={() => setSource('sms')}
              style={[styles.segItem, source === 'sms' && styles.segItemActive]}>
              <Text style={[styles.segText, source === 'sms' && styles.segTextActive]}>SMS</Text>
            </Pressable>
            <Pressable
              testID="src-email"
              onPress={() => setSource('email')}
              style={[styles.segItem, source === 'email' && styles.segItemActive]}>
              <Text style={[styles.segText, source === 'email' && styles.segTextActive]}>Email</Text>
            </Pressable>
          </View>

          <TextInput
            testID="paste-textarea"
            value={text}
            onChangeText={setText}
            placeholder={source === 'sms'
              ? "e.g. HDFC Bank: Rs.499.00 debited from a/c XX1234 on 12-05-25 to SWIGGY BANGALORE. UPI Ref 512345678901."
              : "Paste the body of a bank transaction email…"}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            multiline
            style={styles.textarea}
          />

          <Pressable
            testID="import-submit"
            onPress={doImport}
            disabled={busy || !text.trim()}
            style={[styles.primaryBtn, (!text.trim() || busy) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Parse & Save</Text>}
          </Pressable>

          {result && (
            <View style={styles.resultCard} testID="import-result">
              <Text style={styles.resultTitle}>Import summary</Text>
              <View style={styles.resultRow}>
                <Ionicons name="checkmark-circle" size={16} color={theme.color.success} />
                <Text style={styles.resultText}>{result.saved} saved</Text>
              </View>
              <View style={styles.resultRow}>
                <Ionicons name="alert-circle" size={16} color={theme.color.warning} />
                <Text style={styles.resultText}>{result.duplicates} flagged as duplicate</Text>
              </View>
              <View style={styles.resultRow}>
                <Ionicons name="remove-circle" size={16} color={theme.color.onSurfaceTertiary} />
                <Text style={styles.resultText}>{result.skipped} not a transaction</Text>
              </View>
              <Pressable testID="go-to-txns" onPress={() => router.replace('/(tabs)/transactions')} style={styles.linkBtn}>
                <Text style={styles.linkText}>View transactions →</Text>
              </Pressable>
            </View>
          )}
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
  hint: { color: theme.color.onSurfaceTertiary, fontSize: 13, lineHeight: 20, marginBottom: theme.spacing.md },
  segment: { flexDirection: 'row', backgroundColor: theme.color.surfaceTertiary, borderRadius: 10, padding: 4, marginBottom: theme.spacing.md },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segItemActive: { backgroundColor: theme.color.surfaceSecondary },
  segText: { color: theme.color.onSurfaceTertiary, fontWeight: '600', fontSize: 13 },
  segTextActive: { color: theme.color.onSurface },
  textarea: { minHeight: 200, textAlignVertical: 'top', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: 14, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  primaryBtn: { marginTop: theme.spacing.lg, backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  resultCard: { marginTop: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, gap: 8 },
  resultTitle: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultText: { color: theme.color.onSurface, fontSize: 14 },
  linkBtn: { marginTop: theme.spacing.md },
  linkText: { color: theme.color.brand, fontWeight: '700' },
});
