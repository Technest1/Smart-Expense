import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Platform, ActivityIndicator, PermissionsAndroid, Modal, Alert } from 'react-native';
import { Text } from '@/src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runSmsSync, resetSmsCursor, SmsSyncResult } from '@/src/services/smsSync';
import { theme } from '@/src/theme';
import { SyncOverlay } from '@/src/ui/SyncIndicators';

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
  // ?auto=1: opened by the dashboard's first-run prompt — show the disclosure right away and
  // head back to the dashboard once the first sync is done.
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied' | 'unavailable'>('idle');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SmsSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showDisclosure, setShowDisclosure] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then((ok) => {
      if (ok) setStatus('granted');
      else if (auto === '1') setShowDisclosure(true);
    }).catch(() => {});
  }, [auto]);

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
        if (auto === '1') {
          setBusy(false);
          await syncNow();
          router.replace('/(tabs)');
          return;
        }
      } else {
        setStatus('denied');
      }
    } catch {
      setStatus('unavailable');
    }
    setBusy(false);
  };

  const resyncAll = () =>
    Alert.alert('Re-read all messages?', 'Moneta will read your whole SMS inbox again. Messages it already has are skipped, so nothing is counted twice.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Re-read', onPress: async () => { await resetSmsCursor(); await syncNow(); } },
    ]);

  const syncNow = async () => {
    setBusy(true);
    setSyncing(true);
    setSyncError(null);
    setResult(null);
    const started = Date.now();
    try {
      const r = await runSmsSync();
      setResult(r);
    } catch (e: any) {
      setSyncError(e?.message || 'Sync failed');
    } finally {
      // keep the "syncing" screen up long enough to be read, even if the sync was instant
      await new Promise((res) => setTimeout(res, Math.max(0, 1600 - (Date.now() - started))));
      setSyncing(false);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="sms-sync-screen">
      <View style={styles.topBar}>
        <Pressable testID="sms-sync-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Auto-read SMS</Text>
        <View style={{ width: 40 }} />
      </View>

      <SyncOverlay visible={syncing} />

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
            Background delivery depends on your phone's battery-optimization settings —
            if syncing feels delayed, disable battery optimization / enable auto-launch
            for Moneta.
          </Text>
        </View>

        <Pressable
          testID="request-sms-permission-btn"
          onPress={() => setShowDisclosure(true)}
          disabled={busy}
          style={[styles.primaryBtn, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={theme.color.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Request SMS permission</Text>}
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

        {status === 'granted' && (
          <Pressable testID="resync-all-btn" onPress={resyncAll} disabled={busy} style={[styles.secondaryBtn, { marginTop: theme.spacing.sm }, busy && { opacity: 0.5 }]}>
            <Text style={styles.secondaryBtnText}>Re-read all messages</Text>
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

      {/* Google Play Prominent Disclosure: shown before the runtime permission prompt,
          with an explicit Agree / No thanks choice. */}
      <Modal visible={showDisclosure} transparent animationType="fade" onRequestClose={() => setShowDisclosure(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="sms-disclosure">
            <Text style={styles.modalTitle}>Allow Moneta to read your SMS?</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              <Text style={styles.modalBody}>
                Moneta is an expense and budget tracker. To add your spending automatically,
                it needs to read the SMS messages on your phone, including new messages as they arrive, even when the app is closed.
              </Text>
              <Text style={styles.modalBody}>
                <Text style={styles.modalBold}>How it is used: </Text>
                your phone first picks out only messages from bank/merchant sender IDs that contain
                an amount and a debit/credit word. Only those messages are sent to our server, which
                extracts the amount, merchant and date and adds them as transactions to your budget.
              </Text>
              <Text style={styles.modalBody}>
                <Text style={styles.modalBold}>What is never used: </Text>
                personal messages, OTPs and promotions are not uploaded or stored. Your SMS data is
                not sold or shared with third parties or used for advertising.
              </Text>
              <Text style={styles.modalBody}>You can stop at any time by revoking the SMS permission in Android settings.</Text>
            </ScrollView>
            <Pressable
              testID="sms-disclosure-agree"
              style={styles.primaryBtn}
              onPress={() => { setShowDisclosure(false); requestPerm(); }}>
              <Text style={styles.primaryBtnText}>Agree and continue</Text>
            </Pressable>
            <Pressable
              testID="sms-disclosure-decline"
              style={[styles.secondaryBtn, { marginTop: theme.spacing.sm }]}
              onPress={() => { setShowDisclosure(false); if (auto === '1') router.back(); }}>
              <Text style={styles.secondaryBtnText}>No thanks</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  warnCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: theme.color.warningSurface, borderColor: theme.color.warningBorder, borderWidth: 1, padding: theme.spacing.md, borderRadius: theme.radius.md, marginTop: theme.spacing.lg },
  warnText: { flex: 1, fontSize: 13, color: theme.color.warningText, lineHeight: 19 },
  primaryBtn: { marginTop: theme.spacing.lg, backgroundColor: theme.color.brand, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  primaryBtnText: { color: theme.color.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  statusCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: theme.spacing.md, borderRadius: theme.radius.md, marginTop: theme.spacing.md, borderWidth: 1 },
  statusOk: { backgroundColor: theme.color.brandTertiary, borderColor: 'rgba(91,240,168,0.3)' },
  statusWarn: { backgroundColor: theme.color.warningSurface, borderColor: theme.color.warningBorder },
  statusText: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
  errText: { color: theme.color.error, marginTop: theme.spacing.md, textAlign: 'center' },
  resultCard: { marginTop: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, gap: 8 },
  resultTitle: { fontSize: 14, fontWeight: '700', color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultText: { color: theme.color.onSurface, fontSize: 14 },
  sectionLabel: { fontSize: 11, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginBottom: theme.spacing.sm },
  secondaryBtn: { borderColor: theme.color.borderStrong, borderWidth: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center' },
  secondaryBtnText: { color: theme.color.onSurface, fontWeight: '600', fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: theme.spacing.lg },
  modalCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.lg },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  modalBody: { fontSize: 14, color: theme.color.onSurfaceSecondary, lineHeight: 20, marginBottom: theme.spacing.sm },
  modalBold: { fontWeight: '700', color: theme.color.onSurface },
});
