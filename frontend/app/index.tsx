import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/(tabs)');
    else router.replace('/login');
  }, [user, loading, router]);

  return (
    <View style={styles.center} testID="root-splash">
      <ActivityIndicator color={theme.color.brand} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
});
