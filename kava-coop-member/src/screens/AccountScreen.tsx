import Constants from 'expo-constants';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../config/server';
import { colors, radii, spacing } from '../theme/theme';

export function AccountScreen() {
  const { profile, logout } = useAuth();
  const appVersion = Constants.expoConfig?.version ?? '—';
  const apiHost = getApiBaseUrl();

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need your PIN to open your records again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void logout();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.name}>{profile?.displayName ?? 'Member'}</Text>
        <Text style={styles.id}>ID: {profile?.memberId ?? '—'}</Text>
      </View>

      <Text style={styles.metaLine}>App version {appVersion}</Text>
      <Text style={styles.metaLine}>Server {apiHost}</Text>

      <Text style={styles.note}>
        Consumption and debts are read-only in this app. Chat works when you are online and uses the
        same server. To correct a figure, contact your co-op office.
      </Text>

      <Pressable style={styles.outlineButton} onPress={confirmSignOut}>
        <Text style={styles.outlineText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  name: {
    marginTop: spacing.sm,
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  id: {
    marginTop: spacing.xs,
    fontSize: 15,
    color: colors.textSecondary,
  },
  metaLine: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  note: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  outlineText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.danger,
  },
});
