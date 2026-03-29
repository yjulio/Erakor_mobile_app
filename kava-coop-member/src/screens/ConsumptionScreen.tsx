import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getConsumptionRecords } from '../services/memberApi';
import type { ConsumptionRecord } from '../types/member';
import { colors, radii, spacing } from '../theme/theme';

function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  if (!y || !m || !d) return isoDay;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency === 'VTU' ? 'VUV' : currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

type Section = { title: string; data: ConsumptionRecord[] };

export function ConsumptionScreen() {
  const { apiClient } = useAuth();
  const [records, setRecords] = useState<ConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await getConsumptionRecords(apiClient);
      list.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
      setRecords(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load consumption');
      setRecords([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo<Section[]>(() => {
    const map = new Map<string, ConsumptionRecord[]>();
    for (const r of records) {
      const list = map.get(r.day) ?? [];
      list.push(r);
      map.set(r.day, list);
    }
    const days = [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return days.map((day) => ({
      title: day,
      data: map.get(day) ?? [],
    }));
  }, [records]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Loading your records…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
          <Text style={styles.bannerHint}>
            Ask your co-op to enable member API paths, or check your connection.
          </Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{formatDay(section.title)}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.itemName}>{item.itemName}</Text>
              <Text style={styles.meta}>
                {item.quantity}
                {item.unit ? ` ${item.unit}` : ''}
                {item.unitPrice != null ? ` × ${formatMoney(item.unitPrice, 'VUV')}` : ''}
              </Text>
              {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
            </View>
            <Text style={styles.amount}>{formatMoney(item.totalAmount, 'VUV')}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No consumption yet</Text>
            <Text style={styles.emptySub}>
              When the co-op records your daily kava or purchases against your account, they will
              appear here.
            </Text>
          </View>
        }
        stickySectionHeadersEnabled
        contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.listContent}
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
  banner: {
    margin: spacing.md,
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
  sectionHeader: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
  notes: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  emptyList: {
    flexGrow: 1,
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
