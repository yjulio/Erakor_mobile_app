import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { ChatStackParamList } from '../navigation/ChatStack';
import {
  getConversationTitleForMember,
  listMyConversations,
  startDirectChat,
} from '../services/chat/coopChatApi';
import type { ChatConversationRow } from '../services/chat/types';
import { colors, radii, spacing } from '../theme/theme';

type Nav = NativeStackNavigationProp<ChatStackParamList, 'ChatList'>;

type Row = ChatConversationRow & { displayTitle: string };

export function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const { apiClient } = useAuth();
  const { chatReady, myMemberId } = useChat();
  const isOnline = useOnlineStatus();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmTarget, setDmTarget] = useState('');
  const [dmBusy, setDmBusy] = useState(false);

  const load = useCallback(async () => {
    if (!chatReady || !myMemberId || !isOnline) {
      setLoading(false);
      if (!isOnline) {
        setRows([]);
      }
      return;
    }
    setLoadError(null);
    try {
      const list = await listMyConversations(apiClient);
      const withTitles: Row[] = await Promise.all(
        list.map(async (c) => {
          let displayTitle: string;
          if (c.display_title?.trim()) {
            displayTitle = c.display_title.trim();
          } else if (c.is_group) {
            displayTitle = c.title?.trim() || 'Group';
          } else {
            displayTitle = await getConversationTitleForMember(apiClient, c.id, myMemberId);
          }
          return { ...c, displayTitle };
        })
      );
      setRows(withTitles);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load chats');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiClient, chatReady, myMemberId, isOnline]);

  const wasOnline = useRef(isOnline);

  useEffect(() => {
    if (!wasOnline.current && isOnline && chatReady && myMemberId) {
      setLoading(true);
      void load();
    }
    wasOnline.current = isOnline;
  }, [isOnline, chatReady, myMemberId, load]);

  useFocusEffect(
    useCallback(() => {
      if (!isOnline) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void load();
    }, [load, isOnline])
  );

  function onRefresh() {
    if (!isOnline) {
      return;
    }
    setRefreshing(true);
    void load();
  }

  async function openDm() {
    if (!isOnline) {
      setLoadError('Connect to the internet to message members.');
      return;
    }
    const id = dmTarget.trim();
    if (!id || !myMemberId) {
      return;
    }
    setDmBusy(true);
    try {
      const convId = await startDirectChat(apiClient, id);
      setDmOpen(false);
      setDmTarget('');
      const title = await getConversationTitleForMember(apiClient, convId, myMemberId);
      navigation.navigate('ChatRoom', {
        conversationId: convId,
        title,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not start chat');
    } finally {
      setDmBusy(false);
    }
  }

  if (!chatReady) {
    return (
      <View style={styles.center}>
        <Text style={styles.p}>Sign in to use chat.</Text>
      </View>
    );
  }

  if (!isOnline) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>You&apos;re offline</Text>
        <Text style={styles.p}>
          Chat uses {`kavacoop.innovatelhubltd.com`} and only works when you have an internet
          connection. Check Wi‑Fi or mobile data, then open Chats again.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Loading chats…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable
          style={[styles.primaryBtn, !isOnline && styles.btnDisabled]}
          onPress={() => setDmOpen(true)}
          disabled={!isOnline}
        >
          <Text style={styles.primaryBtnText}>Message a member</Text>
        </Pressable>
        <Text style={styles.hint}>
          Groups are created by an admin on the server; they appear here when you are added.
        </Text>
      </View>

      {loadError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{loadError}</Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            enabled={isOnline}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              navigation.navigate('ChatRoom', {
                conversationId: item.id,
                title: item.displayTitle,
              })
            }
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.displayTitle}</Text>
              <Text style={styles.rowMeta}>{item.is_group ? 'Group' : 'Direct'}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySub}>
              Start a direct message with another member ID, or wait for an admin to add you to a
              group.
            </Text>
          </View>
        }
        contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
      />

      <Modal visible={dmOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Member ID</Text>
            <Text style={styles.modalHint}>Enter the other member&apos;s co-op ID (e.g. 92050).</Text>
            <TextInput
              value={dmTarget}
              onChangeText={setDmTarget}
              placeholder="Member ID"
              autoCapitalize="none"
              style={styles.input}
              editable={!dmBusy}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => setDmOpen(false)} disabled={dmBusy}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtnSm} onPress={openDm} disabled={dmBusy}>
                {dmBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Open chat</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  h1: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  p: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  muted: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 15,
  },
  toolbar: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  primaryBtnSm: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    minWidth: 120,
    alignItems: 'center',
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  banner: {
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: '#fdecea',
    borderRadius: radii.md,
  },
  bannerText: {
    color: colors.danger,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  rowMeta: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chev: {
    fontSize: 22,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
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
  emptyList: {
    flexGrow: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalHint: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  secondaryBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 16,
  },
});
