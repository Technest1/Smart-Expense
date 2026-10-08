import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Platform, TextInput, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

const PRIVACY_URL = 'https://technest1.github.io/Smart-Expense/privacy.html';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: 'chatbubble-ellipses-outline', title: 'Reads your bank SMS', sub: 'Expenses appear on their own, no typing' },
  { icon: 'calendar-outline', title: 'Budgets & reminders', sub: 'See what is due before it leaves your account' },
  { icon: 'shield-checkmark-outline', title: 'Private by design', sub: 'Filtered on your phone; OTPs never leave it' },
];

function GoogleG() {
  return (
    <Svg width={22} height={22} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Native (iOS/Android): Google's own Sign-In SDK (Credential Manager under the hood)
// instead of a browser-redirect OAuth flow — the redirect approach hit a real conflict
// between expo-router's global deep-link handling and expo-auth-session's own redirect
// listener on Android (the OAuth code came back correctly but the sign-in never
// completed). The SDK matches the app via package name + SHA-1 fingerprint (no
// redirect URI involved) and still issues an id_token audienced to our web client,
// which the backend already verifies against GOOGLE_CLIENT_ID.
// v1 is SMS-only — no offlineAccess/gmail.readonly scope requested here, since that's
// a Google-restricted scope requiring a separate CASA security assessment before the
// app can leave testing mode. Gmail sync (backend/server.py's _connect_gmail etc.) is
// still there for v2; re-add offlineAccess + the scope below to wire it back up.
if (Platform.OS !== 'web' && GOOGLE_WEB_CLIENT_ID) {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
}

// Web: a popup-based flow is too fragile (browsers block window.open() unless it
// fires perfectly synchronously on the click, which expo-auth-session's internal
// async prep breaks), so we do Google's own full-page redirect instead and pick
// the id_token back up from the URL fragment on return.
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildGoogleWebRedirectUrl(): string {
  // Land back on /login itself, not the root: the root route immediately
  // client-side-redirects unauthenticated users to /login, which rewrites the
  // URL and wipes the #id_token hash before this screen ever gets to read it.
  const redirectUri = window.location.origin + '/login';
  const params = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    prompt: 'select_account',
    nonce: randomNonce(),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export default function LoginScreen() {
  const { signInWithGoogleIdToken, signInWithReviewerCode } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Play Store reviewer fallback: Google's own rejection notice for this app said
  // their reviewer's device can't use native Google Sign-In (it requires the account
  // be linked to that device) and asked for "a dedicated test bypass". Tapping the
  // badge 5x reveals a code field; the code itself lives only in the Play Console
  // "Instructions for review" field, never in the UI, so real users never see this.
  const [badgeTaps, setBadgeTaps] = useState(0);
  const [showReviewerInput, setShowReviewerInput] = useState(false);
  const [reviewerCode, setReviewerCode] = useState('');
  const onBadgeTap = () => {
    const next = badgeTaps + 1;
    setBadgeTaps(next);
    if (next >= 5) setShowReviewerInput(true);
  };
  const submitReviewerCode = async () => {
    setErr(null);
    setBusy(true);
    try {
      await signInWithReviewerCode(reviewerCode.trim());
    } catch (e: any) {
      setErr(e?.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  // Web: pick up the id_token from the redirect back, once.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const hash = window.location.hash;
    if (!hash || !hash.includes('id_token=')) return;
    const params = new URLSearchParams(hash.slice(1));
    const idToken = params.get('id_token');
    const oauthError = params.get('error');
    window.history.replaceState(null, '', window.location.pathname);
    if (oauthError) {
      setErr(oauthError);
      return;
    }
    if (idToken) {
      setBusy(true);
      signInWithGoogleIdToken(idToken)
        .catch((e: any) => setErr(e?.message || 'Login failed'))
        .finally(() => setBusy(false));
    }
  }, []);

  const loginNative = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (isSuccessResponse(response)) {
        const idToken = response.data.idToken;
        if (!idToken) {
          setErr('Login failed: no id token from Google');
          return;
        }
        await signInWithGoogleIdToken(idToken, response.data.serverAuthCode ?? undefined);
      }
      // 'cancelled' response: user backed out, nothing to do.
    } catch (e: any) {
      setErr(e?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    if (!GOOGLE_WEB_CLIENT_ID) {
      setErr('Google sign-in is not configured yet (missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).');
      return;
    }
    setErr(null);
    setBusy(true);
    if (Platform.OS === 'web') {
      window.location.href = buildGoogleWebRedirectUrl();
      return;
    }
    await loginNative();
  };

  return (
    <View style={styles.root} testID="login-screen">
      <LinearGradient colors={['#17301F', '#2E4F3D', '#3F6A52']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.blobA} />
      <View style={styles.blobB} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} bounces={false} showsVerticalScrollIndicator={false}>
          <View style={styles.top}>
            {/* Tapping the logo 5x reveals the Play Store reviewer code field (see above). */}
            <Pressable onPress={onBadgeTap} style={styles.logoWrap}>
              <Image source={require('@/assets/images/adaptive-icon.png')} style={styles.logo} resizeMode="contain" />
            </Pressable>
            <Text style={styles.brand}>Moneta</Text>
            <Text style={styles.kicker}>AUTO EXPENSE TRACKER</Text>

            <Text style={styles.headline}>Know where your money goes, without lifting a finger.</Text>

            <View style={styles.features}>
              {FEATURES.map((f) => (
                <View key={f.title} style={styles.featureRow}>
                  <View style={styles.featureIcon}>
                    <Ionicons name={f.icon} size={20} color="#DCEBE2" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                    <Text style={styles.featureSub}>{f.sub}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Get started</Text>
            <Text style={styles.cardSub}>Sign in with Google. We only use it to identify you.</Text>

            <Pressable
              testID="google-sign-in-button"
              onPress={login}
              disabled={busy}
              style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}>
              {busy ? (
                <ActivityIndicator color={theme.color.onSurface} />
              ) : (
                <>
                  <GoogleG />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            {showReviewerInput && (
              <View style={{ marginTop: theme.spacing.md, gap: 8 }}>
                <TextInput
                  testID="reviewer-code-input"
                  value={reviewerCode}
                  onChangeText={setReviewerCode}
                  placeholder="Reviewer access code"
                  secureTextEntry
                  autoCapitalize="none"
                  style={styles.reviewerInput}
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                />
                <Pressable
                  testID="reviewer-code-submit"
                  onPress={submitReviewerCode}
                  disabled={busy || !reviewerCode.trim()}
                  style={[styles.googleBtn, { marginTop: 0 }, (busy || !reviewerCode.trim()) && { opacity: 0.5 }]}>
                  <Text style={styles.googleBtnText}>Continue</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.footNote}>
              By continuing you agree to our{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#17301F' },
  blobA: { position: 'absolute', width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(255,255,255,0.05)', top: -110, right: -130 },
  blobB: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.04)', top: 250, left: -140 },
  scroll: { flexGrow: 1, justifyContent: 'space-between' },
  top: { paddingHorizontal: 28, paddingTop: 28 },
  logoWrap: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  logo: { width: 76, height: 76 },
  brand: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginTop: 6 },
  kicker: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 2.2, marginTop: 2 },
  headline: { fontSize: 31, lineHeight: 38, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6, marginTop: 36 },
  features: { marginTop: 30, gap: 18 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  featureSub: { fontSize: 13, color: 'rgba(255,255,255,0.68)', marginTop: 2, lineHeight: 18 },
  card: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 24, paddingTop: 26, paddingBottom: 22, marginTop: 32,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: theme.color.onSurface },
  cardSub: { fontSize: 14, color: theme.color.onSurfaceTertiary, marginTop: 4, lineHeight: 20 },
  googleBtn: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    height: 56, borderRadius: 28, borderWidth: 1, borderColor: '#D5D8D4', backgroundColor: '#FFFFFF',
  },
  googleBtnText: { fontSize: 16, color: theme.color.onSurface, fontWeight: '600' },
  reviewerInput: { borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.md, padding: 12, color: theme.color.onSurface },
  err: { color: theme.color.error, marginTop: theme.spacing.md, textAlign: 'center' },
  footNote: { fontSize: 12, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginTop: 18, lineHeight: 18 },
  link: { color: theme.color.brand, fontWeight: '700', textDecorationLine: 'underline' },
});
