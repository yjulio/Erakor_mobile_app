import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { ChatStackParamList } from '../navigation/ChatStack';
import { listMessages, sendMessage } from '../services/chat/coopChatApi';
import type { ChatMessageRow } from '../services/chat/types';
import { colors, radii, spacing } from '../theme/theme';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatRoom'>;

const POLL_MS = 5000;

export function ChatRoomScreen({ route }: Props) {
  const { conversationId } = route.params;
  const { apiClient } = useAuth();
  const { myMemberId } = useChat();
  const isOnline = useOnlineStatus();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderedMessages = useMemo(
    () =>
      [...messages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [messages]
  );

  const reload = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const list = await listMessages(apiClient, conversationId);
      setMessages(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [apiClient, conversationId, isOnline]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!isOnline || !isFocused) {
      return;
    }
    const id = setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [isOnline, isFocused, reload]);

  async function onSend() {
    if (!isOnline) {
      setError('You are offline. Connect to the internet to send messages.');
      return;
    }
    if (!input.trim() || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendMessage(apiClient, conversationId, input);
      setInput('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  if (!isOnline) {
    return (
      <View style={styles.center}>
        <Text style={styles.offlineTitle}>Offline</Text>
        <Text style={styles.offlineText}>
          Chat needs an internet connection to reach kavacoop.innovatelhubltd.com. Reconnect and open
          this conversation again.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {error ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={orderedMessages}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const mine =
            item.is_mine === true ||
            (Boolean(myMemberId) &&
              Boolean(item.sender_member_id) &&
              item.sender_member_id === myMemberId);
          const label = item.sender_display_name ?? 'Member';
          return (
            <View
              style={[
                styles.bubbleWrap,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
              ]}
            >
              {!mine ? <Text style={styles.sender}>{label}</Text> : null}
              <View style={[styles.bubble, mine ? styles.bubbleBgMine : styles.bubbleBgTheirs]}>
                <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : undefined]}>
                  {item.body}
                </Text>
              </View>
              <Text style={styles.time}>
                {new Date(item.created_at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No messages yet. Say hello.</Text>
          </View>
        }
      />

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message…"
          placeholderTextColor={colors.textSecondary}
          multiline
          editable={!sending && isOnline}
        />
        <Pressable
          style={[styles.sendBtn, (sending || !input.trim() || !isOnline) && styles.sendBtnDisabled]}
          onPress={onSend}
          disabled={sending || !input.trim() || !isOnline}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  offlineTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  offlineText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  banner: {
    padding: spacing.sm,
    backgroundColor: '#fdecea',
  },
  bannerText: {
    color: colors.danger,
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  bubbleWrap: {
    marginBottom: spacing.md,
    maxWidth: '88%',
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  sender: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleBgMine: {
    backgroundColor: colors.primary,
  },
  bubbleBgTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 22,
  },
  bubbleTextMine: {
    color: '#fff',
  },
  time: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textSecondary,
    marginHorizontal: 4,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
