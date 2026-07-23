import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, ActivityIndicator, PermissionsAndroid } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

/**
 * SMS Sync — Android permission flow scaffold.
 *
 * Reading SMS from the inbox is NOT possible in Expo Go / preview and requires:
 * 1. A native APK build (Publish → Generate Android build)
 * 2. `android.permission.READ_SMS` (declared in app.json)
 * 3. A native SMS reader module (e.g., react-native-get-sms-android)
 *
 * This screen requests the permission when available and gives the user a clear
 * status so the plumbing is ready for the APK build.
 */
export default function SmsSyncScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied' | 'unavailable'>('idle');
  const [busy, setBusy] = useState(false);

  const requestPerm = async () => {
    if (Platform.OS !== 'android') {
      setStatus('unavailable');
      return;
    }
    setBusy(true);
    try {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        {
          title: 'Read SMS to track expenses',
          message: 'ExpenseSync will scan bank SMS to auto-track your expenses. Nothing else is read.',
          buttonPositive: 'Allow',
          buttonNegative: 'Not now',
        }
      );
      if (res === PermissionsAndroid.RESULTS.GRANTED) {
        setStatus('granted');
      } else {
        setStatus('denied');
      }
    } catch {
      setStatus('unavailable');
    }
    setBusy(false);
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
            Grant permission to read your bank SMS. We scan only messages from bank
            sender IDs (VM-HDFCBK, ICICI, etc.) and never store the raw text of anything else.
          </Text>
        </View>

        <View style={styles.warnCard} testID="sms-warning">
          <Ionicons name="information-circle" size={20} color={theme.color.warning} />
          <Text style={styles.warnText}>
            This feature only activates in the installed Android app.
            Preview (Expo Go / web) cannot access the SMS inbox. Publish and install the APK build to use it.
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
              {status === 'granted' && 'Permission granted. Actual SMS reading lights up once you install the APK build with the native SMS reader.'}
              {status === 'denied' && 'Permission denied. Enable READ_SMS from Android app settings to try again.'}
              {status === 'unavailable' && 'Not available on this platform. Install the APK build to use this feature.'}
            </Text>
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
  sectionLabel: { fontSize: 11, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginBottom: theme.spacing.sm },
  secondaryBtn: { borderColor: theme.color.borderStrong, borderWidth: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center' },
  secondaryBtnText: { color: theme.color.onSurface, fontWeight: '600', fontSize: 14 },
});
