import Constants from 'expo-constants';

type ExpoExtra = {
  apiBaseUrl?: string;
  memberLoginPath?: string;
  memberConsumptionPath?: string;
  memberDebtsPath?: string;
  /** e.g. /api/mobile/member/chat — conversations, messages, direct live under this prefix */
  memberChatPrefix?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

function trimBase(url: string): string {
  return url.trim().replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  const fromExtra = extra.apiBaseUrl?.trim();
  if (fromExtra) {
    return trimBase(fromExtra);
  }
  return 'https://kavacoop.innovatelhubltd.com';
}

const chatPrefix = (extra.memberChatPrefix ?? '/api/mobile/member/chat').replace(/\/$/, '');

export const chatPaths = {
  conversations: `${chatPrefix}/conversations`,
  conversation: (id: string) => `${chatPrefix}/conversations/${encodeURIComponent(id)}`,
  messages: (id: string) => `${chatPrefix}/conversations/${encodeURIComponent(id)}/messages`,
  direct: `${chatPrefix}/direct`,
} as const;

export const API_ENDPOINTS = {
  login: extra.memberLoginPath ?? '/api/mobile/member/login',
  consumption: extra.memberConsumptionPath ?? '/api/mobile/member/me/consumption',
  debts: extra.memberDebtsPath ?? '/api/mobile/member/me/debts',
} as const;
