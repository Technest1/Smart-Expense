import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Dimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

const { height } = Dimensions.get('window');

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
  const { signInWithGoogleIdToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      <View style={styles.hero}>
        <Image
          source={{ uri: 'https://images.unsplash.com/photo-1483959651481-dc75b89291f1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwyfHxtaW5pbWFsaXN0JTIwYWJzdHJhY3QlMjBnZW9tZXRyaWMlMjBiYWNrZ3JvdW5kJTIwdGV4dHVyZXxlbnwwfHx8fDE3ODQ3NzQyOTZ8MA&ixlib=rb-4.1.0&q=85' }}
          style={styles.heroImage}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['rgba(26,28,27,0.35)', 'rgba(26,28,27,0.85)']}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.heroContent} edges={['top']}>
          <View style={styles.brandBadge}>
            <Ionicons name="wallet" size={20} color={theme.color.brand} />
          </View>
          <Text style={styles.brand}>ExpenseSync</Text>
          <Text style={styles.tagline}>
            Never miss an expense again; your budget updates itself.
          </Text>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.bottomCard}>
        <Text style={styles.cardTitle}>Sign in to continue</Text>
        <Text style={styles.cardSub}>
          We use your Google account only to identify you. Your data stays private.
        </Text>

        <Pressable
          testID="google-sign-in-button"
          onPress={login}
          disabled={busy}
          style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}>
          {busy ? (
            <ActivityIndicator color={theme.color.onSurface} />
          ) : (
            <>
              <View style={styles.googleG}>
                <Text style={styles.googleGText}>G</Text>
              </View>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

        <Text style={styles.footNote}>
          By continuing, you agree to keep track of your finances responsibly.
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  hero: { height: height * 0.55, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroContent: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl, justifyContent: 'flex-end', paddingBottom: theme.spacing.xl },
  brandBadge: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg },
  brand: { fontSize: 34, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  tagline: { fontSize: 16, color: 'rgba(255,255,255,0.85)', marginTop: theme.spacing.sm, lineHeight: 22 },
  bottomCard: {
    flex: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: theme.color.onSurface },
  cardSub: { fontSize: 14, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.xs, lineHeight: 20 },
  googleBtn: {
    marginTop: theme.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 54,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surfaceSecondary,
  },
  googleG: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border },
  googleGText: { color: '#4285F4', fontSize: 18, fontWeight: '700' },
  googleBtnText: { fontSize: 16, color: theme.color.onSurface, fontWeight: '600' },
  err: { color: theme.color.error, marginTop: theme.spacing.md, textAlign: 'center' },
  footNote: { fontSize: 12, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginBottom: theme.spacing.md },
});
