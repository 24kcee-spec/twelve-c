"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearTokens, getStoredTokens, storeTokens } from "./api";
import { UserOut } from "./types";

interface AuthContextValue {
  user: UserOut | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; pendingToken?: string }>;
  googleLogin: (idToken: string) => Promise<{ mfaRequired: boolean; pendingToken?: string }>;
  completeMfaLogin: (pendingToken: string, code: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const { access } = getStoredTokens();
    if (!access) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    if ("mfa_required" in result) {
      return { mfaRequired: true, pendingToken: result.mfa_pending_token };
    }
    storeTokens(result);
    await refreshUser();
    return { mfaRequired: false };
  }, [refreshUser]);

  const googleLogin = useCallback(async (idToken: string) => {
    const result = await api.googleLogin(idToken);
    if ("mfa_required" in result) {
      return { mfaRequired: true, pendingToken: result.mfa_pending_token };
    }
    storeTokens(result);
    await refreshUser();
    return { mfaRequired: false };
  }, [refreshUser]);

  const completeMfaLogin = useCallback(async (pendingToken: string, code: string) => {
    const tokens = await api.mfaLogin(pendingToken, code);
    storeTokens(tokens);
    await refreshUser();
  }, [refreshUser]);

  const register = useCallback(async (email: string, password: string) => {
    await api.register(email, password);
  }, []);

  const logout = useCallback(async () => {
    const { refresh } = getStoredTokens();
    if (refresh) {
      try {
        await api.logout(refresh);
      } catch {
        // best effort — clear local state regardless
      }
    }
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, googleLogin, completeMfaLogin, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
