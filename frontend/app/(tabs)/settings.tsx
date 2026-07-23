import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

export default function Settings() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const confirmLogout = () => {
    Alert.alert('Log out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/login'); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="settings-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.profileCard}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText}>{(user?.name || 'U').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} testID="profile-name">{user?.name || 'User'}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>DATA SOURCES</Text>
        <View style={styles.group}>
          <Pressable testID="paste-messages-btn" style={styles.groupRow} onPress={() => router.push('/import')}>
            <View style={[styles.rowIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Ionicons name="clipboard-outline" size={18} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Paste SMS or email</Text>
              <Text style={styles.rowSub}>Import bank messages manually</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.color.onSurfaceTertiary} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable testID="sms-sync-btn" style={styles.groupRow} onPress={() => router.push('/sms-sync')}>
            <View style={[styles.rowIcon, { backgroundColor: '#EFF0EC' }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.color.onSurfaceSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Auto-read SMS</Text>
              <Text style={styles.rowSub}>Sync bank SMS from your phone</Text>
            </View>
            <View style={styles.pillMuted}><Text style={styles.pillMutedText}>APK only</Text></View>
          </Pressable>

          <View style={styles.divider} />

          <View style={styles.groupRow}>
            <View style={[styles.rowIcon, { backgroundColor: '#EFF0EC' }]}>
              <Ionicons name="mail-outline" size={18} color={theme.color.onSurfaceSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Gmail sync</Text>
              <Text style={styles.rowSub}>Auto-import bank emails (requires Google Cloud setup)</Text>
            </View>
            <View style={styles.pillMuted}><Text style={styles.pillMutedText}>Soon</Text></View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>SPENDING</Text>
        <View style={styles.group}>
          <Pressable testID="budgets-nav" style={styles.groupRow} onPress={() => router.push('/budgets')}>
            <View style={[styles.rowIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Ionicons name="pie-chart-outline" size={18} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Budgets & alerts</Text>
              <Text style={styles.rowSub}>Set monthly caps per category</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.group}>
          <View style={styles.groupRow}>
            <View style={[styles.rowIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Ionicons name="sparkles-outline" size={18} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Parsing engine</Text>
              <Text style={styles.rowSub}>Regex + AI (Claude Sonnet) with dedup</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.groupRow}>
            <View style={[styles.rowIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Version</Text>
              <Text style={styles.rowSub}>Sprint 1 • v0.1</Text>
            </View>
          </View>
        </View>

        <Pressable testID="logout-button" onPress={confirmLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={18} color={theme.color.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: theme.color.onSurface },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: { backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileName: { fontSize: 16, fontWeight: '700', color: theme.color.onSurface },
  profileEmail: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  sectionLabel: { fontSize: 11, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700', marginHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm },
  group: { backgroundColor: theme.color.surfaceSecondary, marginHorizontal: theme.spacing.lg, borderRadius: theme.radius.md, overflow: 'hidden' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface },
  rowSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.color.divider, marginLeft: 60 },
  pillMuted: { backgroundColor: theme.color.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillMutedText: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: '700' },
  logoutBtn: { marginTop: theme.spacing.xl, marginHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#F1D8D8' },
  logoutText: { color: theme.color.error, fontSize: 15, fontWeight: '700' },
});
