import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

const { height } = Dimensions.get('window');

export default function LoginScreen() {
  const { signInWithSessionToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const login = async () => {
    setErr(null);
    setBusy(true);
    try {
      const redirectUrl =
        Platform.OS === 'web'
          ? window.location.origin + '/'
          : Linking.createURL('');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === 'web') {
        window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type !== 'success' || !result.url) {
        setBusy(false);
        return;
      }
      const url = result.url;
      const frag = url.split('#')[1] || url.split('?')[1] || '';
      const params = new URLSearchParams(frag);
      const sid = params.get('session_id');
      if (!sid) {
        setErr('Login failed: no session id');
        setBusy(false);
        return;
      }
      await signInWithSessionToken(sid);
    } catch (e: any) {
      setErr(e?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
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
            Track every expense from your SMS and email — deduped, categorised, and always in your pocket.
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
