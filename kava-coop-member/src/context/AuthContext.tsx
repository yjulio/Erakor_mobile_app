import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createMemberApi, postMemberLogin, registerSessionInvalidHandler } from '../services/memberApi';
import type { MemberProfile } from '../types/member';

const TOKEN_KEY = 'kava_member_token';
const PROFILE_KEY = 'kava_member_profile';

type AuthState = {
  token: string | null;
  profile: MemberProfile | null;
  ready: boolean;
};

type AuthContextValue = AuthState & {
  login: (memberId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  apiClient: ReturnType<typeof createMemberApi>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadStoredAuth(): Promise<{ token: string | null; profile: MemberProfile | null }> {
  try {
    const [token, profileJson] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(PROFILE_KEY),
    ]);
    let profile: MemberProfile | null = null;
    if (profileJson) {
      const parsed = JSON.parse(profileJson) as MemberProfile;
      if (parsed && typeof parsed.memberId === 'string') {
        profile = parsed;
      }
    }
    return { token: token || null, profile };
  } catch {
    return { token: null, profile: null };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { token: t, profile: p } = await loadStoredAuth();
      if (!cancelled) {
        setToken(t);
        setProfile(p);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getToken = useCallback(async () => token, [token]);

  const apiClient = useMemo(() => createMemberApi(getToken), [getToken]);

  const login = useCallback(
    async (memberId: string, pin: string) => {
      const { accessToken, profile: p } = await postMemberLogin(apiClient, memberId.trim(), pin);
      await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(p));
      setToken(accessToken);
      setProfile(p);
    },
    [apiClient]
  );

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(PROFILE_KEY);
    setToken(null);
    setProfile(null);
  }, []);

  useEffect(() => {
    registerSessionInvalidHandler(() => {
      void logout();
    });
    return () => registerSessionInvalidHandler(null);
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      profile,
      ready,
      login,
      logout,
      apiClient,
    }),
    [token, profile, ready, login, logout, apiClient]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
