import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, ActivityIndicator, PermissionsAndroid } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runSmsSync, SmsSyncResult } from '@/src/services/smsSync';
import { theme } from '@/src/theme';

/**
 * SMS Sync — real Android SMS reading.
 *
 * Reading SMS from the inbox only works in a native APK build (not Expo Go / web
 * preview) and requires `android.permission.READ_SMS` + `RECEIVE_SMS` (declared in
 * app.json) plus the native SmsReceiver/SmsHeadlessTaskService wired in via
 * plugins/withSmsReceiver.js — those pick up new SMS automatically in the background.
 * The "Sync now" button below runs the exact same logic on demand.
 */
export default function SmsSyncScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied' | 'unavailable'>('idle');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SmsSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const requestPerm = async () => {
    if (Platform.OS !== 'android') {
      setStatus('unavailable');
      return;
    }
    setBusy(true);
    try {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      ]);
      if (res[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED) {
        setStatus('granted');
      } else {
        setStatus('denied');
      }
    } catch {
      setStatus('unavailable');
    }
    setBusy(false);
  };

  const syncNow = async () => {
    setBusy(true);
    setSyncError(null);
    setResult(null);
    try {
      const r = await runSmsSync();
      setResult(r);
    } catch (e: any) {
      setSyncError(e?.message || 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sms-sync-screen">
      <View style={styles.topBar}>
        <Pressable testID="sms-sync-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Auto-read SMS</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="chatbubble-ellipses" size={30} color={theme.color.brand} />
          </View>
          <Text style={styles.heroTitle}>Track expenses automatically</Text>
          <Text style={styles.heroSub}>
            Grant permission to read your bank SMS. We check messages on your device
            first — only ones from bank/merchant sender IDs (not personal contacts)
            that actually look like a transaction are sent for parsing; everything
            else, including OTPs and promotions, never leaves your phone. New SMS are
            picked up automatically in the background, even when the app is closed.
          </Text>
        </View>

        <View style={styles.warnCard} testID="sms-warning">
          <Ionicons name="information-circle" size={20} color={theme.color.warning} />
          <Text style={styles.warnText}>
            This feature only works in the installed native app, not Expo Go/web preview.
            Background delivery depends on your phone's battery-optimization settings —
            if syncing feels delayed, disable battery optimization / enable auto-launch
            for this app.
          </Text>
        </View>

        <Pressable
          testID="request-sms-permission-btn"
          onPress={requestPerm}
          disabled={busy}
          style={[styles.primaryBtn, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Request SMS permission</Text>}
        </Pressable>

        {status !== 'idle' && (
          <View style={[styles.statusCard, status === 'granted' && styles.statusOk, status !== 'granted' && styles.statusWarn]} testID={`sms-status-${status}`}>
            <Ionicons
              name={status === 'granted' ? 'checkmark-circle' : status === 'denied' ? 'close-circle' : 'alert-circle'}
              size={18}
              color={status === 'granted' ? theme.color.success : theme.color.warning}
            />
            <Text style={styles.statusText}>
              {status === 'granted' && 'Permission granted. Tap "Sync now" to read your inbox, or wait for new SMS to sync automatically.'}
              {status === 'denied' && 'Permission denied. Enable READ_SMS from Android app settings to try again.'}
              {status === 'unavailable' && 'Not available on this platform. Install the native Android app to use this feature.'}
            </Text>
          </View>
        )}

        {status === 'granted' && (
          <Pressable
            testID="sync-now-btn"
            onPress={syncNow}
            disabled={busy}
            style={[styles.secondaryBtn, { marginTop: theme.spacing.md }, busy && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color={theme.color.onSurface} /> : <Text style={styles.secondaryBtnText}>Sync now</Text>}
          </Pressable>
        )}

        {syncError ? <Text style={styles.errText} testID="sync-error">{syncError}</Text> : null}

        {result && (
          <View style={styles.resultCard} testID="sync-result">
            <Text style={styles.resultTitle}>Sync summary</Text>
            <View style={styles.resultRow}>
              <Ionicons name="mail-open" size={16} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.resultText}>{result.scanned} bank-like messages scanned</Text>
            </View>
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
          </View>
        )}

        <View style={{ marginTop: theme.spacing.xl }}>
          <Text style={styles.sectionLabel}>PREFER MANUAL?</Text>
          <Pressable testID="fallback-import" onPress={() => router.push('/import')} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Paste SMS or email instead</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  heroCard: { alignItems: 'center', padding: theme.spacing.xl, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md },
  heroIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  heroTitle: { fontSize: 18, fontWeight: '700', color: theme.color.onSurface, textAlign: 'center' },
  heroSub: { fontSize: 13, color: theme.color.onSurfaceTertiary, textAlign: 'center', lineHeight: 20, marginTop: theme.spacing.sm },
  warnCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FDF6E6', borderColor: '#F3E1B2', borderWidth: 1, padding: theme.spacing.md, borderRadius: theme.radius.md, marginTop: theme.spacing.lg },
  warnText: { flex: 1, fontSize: 13, color: '#7A5A1F', lineHeight: 19 },
  primaryBtn: { marginTop: theme.spacing.lg, backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  statusCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: theme.spacing.md, borderRadius: theme.radius.md, marginTop: theme.spacing.md, borderWidth: 1 },
  statusOk: { backgroundColor: '#E5EBE7', borderColor: '#C7DCC7' },
  statusWarn: { backgroundColor: '#FDF6E6', borderColor: '#F3E1B2' },
  statusText: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
  errText: { color: theme.color.error, marginTop: theme.spacing.md, textAlign: 'center' },
  resultCard: { marginTop: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, gap: 8 },
  resultTitle: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultText: { color: theme.color.onSurface, fontSize: 14 },
  sectionLabel: { fontSize: 11, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginBottom: theme.spacing.sm },
  secondaryBtn: { borderColor: theme.color.borderStrong, borderWidth: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center' },
  secondaryBtnText: { color: theme.color.onSurface, fontWeight: '600', fontSize: 14 },
});
