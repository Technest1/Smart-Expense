import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppRegistry, LogBox, Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { useFonts } from 'expo-font';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { runSmsSync } from '@/src/services/smsSync';
import { theme } from '@/src/theme';

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Registered at module scope so it's in place before the OS starts the headless
// task from SmsReceiver.kt — the headless launch still evaluates this same JS
// bundle/entry point, just without mounting an Activity.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('SmsSyncTask', () => async () => {
    // SMS_RECEIVED fires before the default messaging app has written the message to
    // the inbox provider, so a sync run immediately would miss it. Wait, then sync,
    // then sync once more to catch a slow write.
    await new Promise((r) => setTimeout(r, 4000));
    await runSmsSync();
    await new Promise((r) => setTimeout(r, 6000));
    await runSmsSync();
  });
}

function RootNav() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === 'login';
    if (!user && !inAuth) {
      router.replace('/login');
    } else if (user && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.center} testID="auth-loading">
        <ActivityIndicator color={theme.color.brand} size="large" />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.surface } }} />;
}

export default function RootLayout() {
  const [iconsLoaded, error] = useIconFonts();
  const [fontsLoaded, fontError] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold });
  const loaded = iconsLoaded && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNav />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
});
