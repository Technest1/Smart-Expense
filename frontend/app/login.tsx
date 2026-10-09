import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator, Image, Platform, ScrollView, Linking, Animated, Easing } from 'react-native';
import { Text, TextInput } from '@/src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';
import { SpinnerRing, SyncOverlay } from '@/src/ui/SyncIndicators';

const PRIVACY_URL = 'https://technest1.github.io/Smart-Expense/privacy.html';
const MINT = '#5BF0A8';
const F = theme.fontFamily;

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

// Soft light: stacked translucent circles read as a blurred glow on every platform.
function Glow({ size, color, style }: { size: number; color: string; style: object }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {Array.from({ length: 22 }, (_, i) => 1 - i * 0.04).map((k) => (
        <View key={k} style={{ position: 'absolute', width: size * k, height: size * k, borderRadius: size, backgroundColor: color, opacity: 0.022 }} />
      ))}
    </View>
  );
}

// Gentle idle float so the hero cards feel alive.
function Float({ children, dy = 6, ms = 3200, style }: { children: React.ReactNode; dy?: number; ms?: number; style?: object }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, ms]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [-dy, dy] });
  return <Animated.View style={[style, { transform: [{ translateY }] }]}>{children}</Animated.View>;
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

type Scene = {
  amount: number; bars: number[]; due: string;
  txn: { name: string; cat: string; amt: string; icon: keyof typeof Ionicons.glyphMap; tint: string };
};
// Illustrative only: cycles every 8s while the login screen is showing.
const SCENES: Scene[] = [
  { amount: 24860, bars: [0.45, 0.7, 0.35, 0.85, 0.55, 0.65, 1], due: 'Netflix due in 3 days',
    txn: { name: 'Swiggy', cat: 'Food & Dining', amt: '−₹499', icon: 'restaurant', tint: '#FFB27A' } },
  { amount: 18340, bars: [0.3, 0.5, 0.8, 0.4, 0.6, 0.35, 0.9], due: 'Electricity due in 2 days',
    txn: { name: 'Flipkart', cat: 'Shopping', amt: '−₹1,299', icon: 'bag-handle', tint: '#C7A6FF' } },
  { amount: 31720, bars: [0.6, 0.4, 0.95, 0.7, 0.5, 0.8, 1], due: 'Rent due in 5 days',
    txn: { name: 'Amazon', cat: 'Shopping', amt: '−₹2,349', icon: 'cube', tint: '#FFD27A' } },
  { amount: 12905, bars: [0.25, 0.4, 0.3, 0.55, 0.35, 0.5, 0.75], due: 'Spotify due in 4 days',
    txn: { name: 'Uber', cat: 'Transport', amt: '−₹286', icon: 'car', tint: '#8DB8FF' } },
  { amount: 27480, bars: [0.5, 0.85, 0.45, 0.6, 0.9, 0.55, 0.8], due: 'Airtel due in 6 days',
    txn: { name: 'BigBasket', cat: 'Groceries', amt: '−₹1,184', icon: 'basket', tint: '#8BE5A8' } },
  { amount: 9640, bars: [0.2, 0.35, 0.5, 0.3, 0.45, 0.6, 0.55], due: 'Insurance due in 7 days',
    txn: { name: 'Myntra', cat: 'Shopping', amt: '−₹899', icon: 'shirt', tint: '#FF9EC4' } },
  { amount: 21175, bars: [0.55, 0.65, 0.4, 0.75, 0.5, 0.9, 0.7], due: 'Broadband due tomorrow',
    txn: { name: 'Zomato', cat: 'Food & Dining', amt: '−₹612', icon: 'fast-food', tint: '#FF8A7A' } },
];
const SCENE_MS = 8000;

function HeroPreview() {
  const [idx, setIdx] = useState(0);
  const [amount, setAmount] = useState(SCENES[0].amount);
  const fade = useRef(new Animated.Value(1)).current;
  const amountV = useRef(new Animated.Value(SCENES[0].amount)).current;
  const barsV = useRef(SCENES[0].bars.map((h) => new Animated.Value(h))).current;

  useEffect(() => {
    const id = amountV.addListener(({ value }) => setAmount(Math.round(value)));
    return () => amountV.removeListener(id);
  }, [amountV]);

  const cur = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = (cur.current + 1) % SCENES.length;
      cur.current = next;
      // text cards fade out, swap, fade in; amount and bars glide to the new values
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(() => {
        setIdx(next);
        Animated.timing(fade, { toValue: 1, duration: 380, useNativeDriver: Platform.OS !== 'web' }).start();
      });
      Animated.timing(amountV, { toValue: SCENES[next].amount, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      barsV.forEach((v, i) => Animated.timing(v, { toValue: SCENES[next].bars[i], duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start());
    }, SCENE_MS);
    return () => clearInterval(timer);
  }, [fade, amountV, barsV]);

  const sc = SCENES[idx];
  return (
    <View style={styles.hero}>
      <Float dy={5} ms={3600} style={styles.cardMain}>
        <Text style={styles.cardLabel}>Spent this month</Text>
        <Text style={styles.cardAmount}>₹{amount.toLocaleString('en-IN')}</Text>
        <View style={styles.bars}>
          {barsV.map((v, i) => (
            <Animated.View
              key={i}
              style={[styles.bar, { height: v.interpolate({ inputRange: [0, 1], outputRange: [10, 52] }) }, i === 6 && { backgroundColor: MINT }]}
            />
          ))}
        </View>
      </Float>

      <Float dy={7} ms={3000} style={styles.cardTxn}>
        <Animated.View style={[styles.txnInner, { opacity: fade }]}>
          <View style={[styles.txnIcon, { backgroundColor: sc.txn.tint + '29' }]}>
            <Ionicons name={sc.txn.icon} size={16} color={sc.txn.tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.txnTitle}>{sc.txn.name}</Text>
            <Text style={styles.txnSub}>{sc.txn.cat}</Text>
          </View>
          <Text style={styles.txnAmt}>{sc.txn.amt}</Text>
        </Animated.View>
      </Float>

      <Float dy={6} ms={4000} style={styles.cardDue}>
        <Animated.View style={[styles.dueInner, { opacity: fade }]}>
          <Ionicons name="notifications" size={14} color={MINT} />
          <Text style={styles.dueText}>{sc.due}</Text>
        </Animated.View>
      </Float>
    </View>
  );
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
      <SyncOverlay visible={busy} title="Signing you in" subtitle="Setting up your account. This can take a few seconds." />
      <Glow size={460} color="#2BD98A" style={{ top: -170, left: -170 }} />
      <Glow size={380} color="#1FA878" style={{ top: 230, right: -190 }} />
      <Glow size={320} color="#B8F04A" style={{ bottom: -140, left: -90 }} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} bounces={false} showsVerticalScrollIndicator={false}>
          <View>
            {/* Tapping the logo 5x reveals the Play Store reviewer code field (see above). */}
            <Pressable onPress={onBadgeTap} style={styles.brandRow}>
              <Image source={require('@/assets/images/adaptive-icon.png')} style={styles.logo} resizeMode="contain" />
              <Text style={styles.brand}>Moneta</Text>
            </Pressable>

            {/* Illustrative preview of the app */}
            <HeroPreview />

            <Text style={styles.headline}>
              Your money,{'\n'}
              <Text style={{ color: MINT }}>automatically</Text> tracked.
            </Text>
            <Text style={styles.sub}>
              Moneta reads your bank SMS on this phone and keeps your budgets and upcoming bills up to date.
            </Text>
          </View>

          <View style={styles.bottom}>
            <Pressable
              testID="google-sign-in-button"
              onPress={login}
              disabled={busy}
              style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] }]}>
              {busy ? <SpinnerRing size={22} thickness={3} color="#0B1410" /> : <GoogleG />}
              <Text style={styles.googleBtnText}>{busy ? 'Signing you in…' : 'Continue with Google'}</Text>
            </Pressable>

            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            {showReviewerInput && (
              <View style={{ marginTop: 14, gap: 10 }}>
                <TextInput
                  testID="reviewer-code-input"
                  value={reviewerCode}
                  onChangeText={setReviewerCode}
                  placeholder="Reviewer access code"
                  secureTextEntry
                  autoCapitalize="none"
                  style={styles.reviewerInput}
                  placeholderTextColor="rgba(255,255,255,0.45)"
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

            <View style={styles.trustRow}>
              <Ionicons name="lock-closed" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={styles.trustText}>Private by design. SMS are filtered on your phone.</Text>
            </View>
            <Text style={styles.footNote}>
              By continuing you agree to our{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const glass = {
  backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 22,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07100C', overflow: 'hidden' },
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 14, paddingBottom: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  logo: { width: 52, height: 52, marginLeft: -8 },
  brand: { fontFamily: F.bold, fontSize: 22, color: '#FFFFFF', letterSpacing: -0.3 },

  hero: { height: 262, marginTop: 10 },
  cardMain: { ...glass, position: 'absolute', left: 0, top: 26, width: '76%', padding: 20, transform: [{ rotate: '-3deg' }] },
  cardLabel: { fontFamily: F.medium, fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  cardAmount: { fontFamily: F.bold, fontSize: 40, color: '#FFFFFF', letterSpacing: -1, marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 16, height: 52 },
  bar: { width: 14, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.22)' },
  cardTxn: { ...glass, position: 'absolute', right: 0, bottom: 0, width: '70%', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: 'rgba(20,38,29,0.82)' },
  txnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  txnIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  txnTitle: { fontFamily: F.semibold, fontSize: 14, color: '#FFFFFF' },
  txnSub: { fontFamily: F.regular, fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  txnAmt: { fontFamily: F.bold, fontSize: 14, color: '#FFFFFF' },
  cardDue: { ...glass, position: 'absolute', right: 6, top: 0, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(91,240,168,0.14)', borderColor: 'rgba(91,240,168,0.32)' },
  dueInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dueText: { fontFamily: F.medium, fontSize: 12.5, color: '#D8FBE9' },

  headline: { fontFamily: F.extrabold, fontSize: 42, lineHeight: 46, color: '#FFFFFF', letterSpacing: -1.3, marginTop: 30 },
  sub: { fontFamily: F.regular, fontSize: 15.5, lineHeight: 23, color: 'rgba(255,255,255,0.7)', marginTop: 14 },

  bottom: { marginTop: 26 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF', shadowColor: '#5BF0A8', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  googleBtnText: { fontFamily: F.semibold, fontSize: 16.5, color: '#0B1410' },
  reviewerInput: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 16, padding: 14, color: '#FFFFFF', fontFamily: F.regular },
  err: { fontFamily: F.medium, color: '#FF9C9C', marginTop: 12, textAlign: 'center' },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  trustText: { fontFamily: F.regular, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  footNote: { fontFamily: F.regular, fontSize: 12, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 8 },
  link: { color: '#FFFFFF', fontFamily: F.semibold, textDecorationLine: 'underline' },
});
