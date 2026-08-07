"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, setTokens, hasAccessToken } from "./api";
import { UserOut, TokenPair, MfaRequiredResponse } from "./types";

const MFA_PENDING_KEY = "twelvec_mfa_pending";

function isMfaRequired(res: TokenPair | MfaRequiredResponse): res is MfaRequiredResponse {
  return (res as MfaRequiredResponse).mfa_required === true;
}

interface AuthContextType {
  user: UserOut | null;
  loading: boolean;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  loginWithGoogle: (idToken: string) => Promise<{ mfaRequired: boolean }>;
  completeMfaLogin: (pendingToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (hasAccessToken()) {
        await refreshUser();
      }
      setLoading(false);
    })();
  }, [refreshUser]);

  const register = async (email: string, password: string) => {
    await api.register(email, password);
  };

  const handleAuthResult = async (result: TokenPair | MfaRequiredResponse): Promise<{ mfaRequired: boolean }> => {
    if (isMfaRequired(result)) {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(MFA_PENDING_KEY, result.mfa_pending_token);
      }
      return { mfaRequired: true };
    }
    setTokens(result);
    await refreshUser();
    return { mfaRequired: false };
  };

  const login = async (email: string, password: string) => {
    const result = await api.login(email, password);
    return handleAuthResult(result);
  };

  const loginWithGoogle = async (idToken: string) => {
    const result = await api.googleAuth(idToken);
    return handleAuthResult(result);
  };

  const completeMfaLogin = async (pendingToken: string, code: string) => {
    const tokens = await api.mfaLogin(pendingToken, code);
    setTokens(tokens);
    await refreshUser();
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, register, login, loginWithGoogle, completeMfaLogin, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
