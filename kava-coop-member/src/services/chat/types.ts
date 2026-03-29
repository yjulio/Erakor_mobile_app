export interface ChatConversationRow {
  id: string;
  title: string | null;
  is_group: boolean;
  updated_at: string | null;
  /** When the server sends a ready-made label (e.g. group name or DM peer name) */
  display_title?: string | null;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  sender_display_name?: string | null;
  /** Co-op member id of the sender — used to align bubbles with the signed-in member */
  sender_member_id: string | null;
  /** Legacy / internal id for keys */
  user_id: string;
  /** When the API marks the current user as sender */
  is_mine?: boolean | null;
}
