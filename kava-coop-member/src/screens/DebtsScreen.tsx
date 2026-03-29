import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getMemberDebts } from '../services/memberApi';
import type { DebtLine } from '../types/member';
import { colors, radii, spacing } from '../theme/theme';

function formatMoney(amount: number, currency: string): string {
  const code = currency === 'VTU' ? 'VUV' : currency;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function DebtsScreen() {
  const { apiClient } = useAuth();
  const [totalOwed, setTotalOwed] = useState(0);
  const [currency, setCurrency] = useState('VTU');
  const [lines, setLines] = useState<DebtLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const view = await getMemberDebts(apiClient);
      setTotalOwed(view.totalOwed);
      setCurrency(view.currency);
      setLines(view.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load debts');
      setLines([]);
      setTotalOwed(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
  }, [load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Loading balances…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Total outstanding</Text>
        <Text style={styles.summaryAmount}>{formatMoney(totalOwed, currency)}</Text>
        <Text style={styles.summaryHint}>Amounts the co-op shows as owed on your account.</Text>
      </View>

      {error ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
          <Text style={styles.bannerHint}>
            Your server should expose a member debts endpoint, or try again when online.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        contentContainerStyle={lines.length === 0 ? styles.emptyList : styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.desc}>{item.description}</Text>
              {item.reference ? <Text style={styles.ref}>Ref: {item.reference}</Text> : null}
              {item.asOfDate ? <Text style={styles.date}>As of {item.asOfDate}</Text> : null}
            </View>
            <Text style={styles.lineAmount}>{formatMoney(item.amount, item.currency || currency)}</Text>
          </View>
        )}
        ListEmptyComponent={
          !error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No debt lines</Text>
              <Text style={styles.emptySub}>
                If you owe the co-op for kava or supplies, itemised lines will list here once the
                office posts them to your member account.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  muted: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  summary: {
    margin: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryAmount: {
    marginTop: spacing.sm,
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
  },
  summaryHint: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  banner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: '#fdecea',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#f5c2c0',
  },
  bannerText: {
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  bannerHint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  emptyList: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    paddingRight: spacing.md,
  },
  desc: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  ref: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  date: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  lineAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.danger,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySub: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
