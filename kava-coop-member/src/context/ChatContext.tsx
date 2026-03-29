import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

type ChatContextValue = {
  /** Signed-in member can use chat (same server as consumption/debts) */
  chatReady: boolean;
  myMemberId: string | null;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { token, profile } = useAuth();

  const value = useMemo<ChatContextValue>(
    () => ({
      chatReady: Boolean(token && profile),
      myMemberId: profile?.memberId ?? null,
    }),
    [token, profile?.memberId]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return ctx;
}
