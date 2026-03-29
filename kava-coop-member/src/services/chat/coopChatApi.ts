import axios, { AxiosError, AxiosInstance } from 'axios';
import { chatPaths } from '../../config/server';
import type { ChatConversationRow, ChatMessageRow } from './types';

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function messageFromAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ detail?: unknown; message?: string }>;
    const d = ax.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0] && typeof (d[0] as { msg?: string }).msg === 'string') {
      return (d[0] as { msg: string }).msg;
    }
    const m = ax.response?.data?.message;
    if (typeof m === 'string') return m;
    if (ax.response?.status === 404) return 'Chat is not available on this server yet.';
    if (ax.response?.status === 401) return 'Session expired. Sign in again.';
  }
  if (err instanceof Error) return err.message;
  return 'Request failed';
}

function extractArray(payload: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload as Record<string, unknown>[];
  }
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return [];
}

function mapConversation(raw: Record<string, unknown>): ChatConversationRow {
  return {
    id: str(raw.id ?? raw.conversation_id),
    title: (() => {
      const t = raw.title ?? raw.name;
      const s = str(t);
      return s || null;
    })(),
    is_group: Boolean(raw.is_group ?? raw.isGroup ?? raw.group),
    updated_at: (() => {
      const u = raw.updated_at ?? raw.updatedAt ?? raw.last_message_at;
      return str(u) || null;
    })(),
    display_title: (() => {
      const d = raw.display_title ?? raw.displayTitle ?? raw.label;
      const s = str(d);
      return s || null;
    })(),
  };
}

function mapMessage(raw: Record<string, unknown>, conversationId: string): ChatMessageRow {
  const senderMember =
    str(raw.sender_member_id ?? raw.member_id ?? raw.from_member_id ?? raw.senderMemberId) ||
    null;
  const uid = str(raw.user_id ?? raw.sender_id ?? raw.sender_user_id ?? senderMember ?? raw.id);
  const isMine = raw.is_mine ?? raw.mine ?? raw.from_me;
  return {
    id: str(raw.id ?? raw.message_id),
    conversation_id: str(raw.conversation_id ?? conversationId),
    user_id: uid,
    body: str(raw.body ?? raw.text ?? raw.content ?? raw.message),
    created_at: str(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    sender_display_name: (() => {
      const n = raw.sender_display_name ?? raw.sender_name ?? raw.display_name;
      const s = str(n);
      return s || null;
    })(),
    sender_member_id: senderMember,
    is_mine:
      typeof isMine === 'boolean'
        ? isMine
        : typeof isMine === 'string'
          ? isMine === 'true' || isMine === '1'
          : null,
  };
}

export async function listMyConversations(client: AxiosInstance): Promise<ChatConversationRow[]> {
  try {
    const { data } = await client.get<unknown>(chatPaths.conversations);
    return extractArray(data, ['conversations', 'items', 'data', 'results']).map((row) =>
      mapConversation(row)
    );
  } catch (e) {
    throw new Error(messageFromAxiosError(e));
  }
}

export async function getConversationMeta(
  client: AxiosInstance,
  conversationId: string
): Promise<{ title: string; is_group: boolean } | null> {
  try {
    const { data } = await client.get<Record<string, unknown>>(chatPaths.conversation(conversationId));
    if (!data || typeof data !== 'object') {
      return null;
    }
    const title =
      str(data.display_title ?? data.displayTitle ?? data.title ?? data.name) || 'Chat';
    const is_group = Boolean(data.is_group ?? data.isGroup);
    return { title, is_group };
  } catch {
    return null;
  }
}

export async function getConversationTitleForMember(
  client: AxiosInstance,
  conversationId: string,
  _myMemberId: string
): Promise<string> {
  const meta = await getConversationMeta(client, conversationId);
  if (meta?.title) {
    return meta.title;
  }
  return 'Chat';
}

export async function listMessages(
  client: AxiosInstance,
  conversationId: string,
  params?: { since?: string }
): Promise<ChatMessageRow[]> {
  try {
    const { data } = await client.get<unknown>(chatPaths.messages(conversationId), { params });
    const rows = extractArray(data, ['messages', 'items', 'data', 'results']);
    return rows.map((row) => mapMessage(row, conversationId));
  } catch (e) {
    throw new Error(messageFromAxiosError(e));
  }
}

export async function sendMessage(
  client: AxiosInstance,
  conversationId: string,
  body: string
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    return;
  }
  try {
    await client.post(chatPaths.messages(conversationId), {
      body: trimmed,
      text: trimmed,
      content: trimmed,
    });
  } catch (e) {
    throw new Error(messageFromAxiosError(e));
  }
}

export async function startDirectChat(client: AxiosInstance, targetMemberId: string): Promise<string> {
  try {
    const { data } = await client.post<Record<string, unknown>>(chatPaths.direct, {
      target_member_id: targetMemberId.trim(),
      member_id: targetMemberId.trim(),
    });
    const id =
      str(data?.conversation_id ?? data?.conversationId ?? data?.id) ||
      str((data as { data?: { id?: string } })?.data?.id);
    if (!id) {
      throw new Error('Server did not return a conversation id');
    }
    return id;
  } catch (e) {
    throw new Error(messageFromAxiosError(e));
  }
}
