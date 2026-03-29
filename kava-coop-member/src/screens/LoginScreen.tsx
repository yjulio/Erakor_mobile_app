import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, radii, spacing } from '../theme/theme';

export function LoginScreen() {
  const { login } = useAuth();
  const [memberId, setMemberId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!memberId.trim() || !pin) {
      setError('Enter your member ID and PIN.');
      return;
    }
    setBusy(true);
    try {
      await login(memberId.trim(), pin);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.title}>Kava Co-op</Text>
        <Text style={styles.sub}>Member sign-in to view consumption and debts.</Text>

        <Text style={styles.label}>Member ID</Text>
        <TextInput
          value={memberId}
          onChangeText={setMemberId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. 92050"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          editable={!busy}
        />

        <Text style={styles.label}>PIN</Text>
        <TextInput
          value={pin}
          onChangeText={setPin}
          secureTextEntry
          keyboardType="number-pad"
          placeholder="••••"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          editable={!busy}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logo: {
    width: 72,
    height: 72,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  sub: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.danger,
    marginBottom: spacing.md,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
