"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { api, setAccessToken } from "./api";
import { UserOut, TokenPair, AccessTokenResponse, MfaRequiredResponse } from "./types";

const MFA_PENDING_KEY = "twelvec_mfa_pending";

function isMfaRequired(
  res: TokenPair | AccessTokenResponse | MfaRequiredResponse
): res is MfaRequiredResponse {
  return (res as MfaRequiredResponse).mfa_required === true;
}

interface AuthContextType {
  user: UserOut | null;
  loading: boolean;
  studyError: string | null;
  startStudySession: () => Promise<void>;
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
  const [studyError, setStudyError] = useState<string | null>(null);
  const pathname = usePathname();

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  const startStudySession = useCallback(async () => {
    setLoading(true);
    setStudyError(null);
    try {
      const tokens = await api.createStudySession();
      setAccessToken(tokens.access_token);
      const me = await api.me();
      if (!me.is_study_guest) {
        throw new Error("The API did not return an anonymous research session.");
      }
      setUser(me);
    } catch {
      setAccessToken(null);
      setUser(null);
      setStudyError("Twelve C could not start the research session. Check the API connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const isStudyEntry = pathname === "/study" || pathname?.startsWith("/study/");

    if (isStudyEntry) {
      // A separate httpOnly cookie keeps the temporary study session
      // independent from any normal account already signed in in this browser.
      setAccessToken(null);
      setUser(null);
      void startStudySession();
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setStudyError(null);
      try {
        // Resume an anonymous research session first when one exists. This
        // endpoint returns 401 for ordinary visitors and never creates a guest.
        let tokens: AccessTokenResponse;
        try {
          tokens = await api.refreshStudySession();
        } catch {
          tokens = await api.refresh();
        }

        if (cancelled) return;
        setAccessToken(tokens.access_token);
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        if (cancelled) return;
        setAccessToken(null);
        setUser(null);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, startStudySession]);

  const register = async (email: string, password: string) => {
    await api.register(email, password);
  };

  const handleAuthResult = async (
    result: TokenPair | AccessTokenResponse | MfaRequiredResponse
  ): Promise<{ mfaRequired: boolean }> => {
    if (isMfaRequired(result)) {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(MFA_PENDING_KEY, result.mfa_pending_token);
      }
      return { mfaRequired: true };
    }
    setAccessToken(result.access_token);
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
    setAccessToken(tokens.access_token);
    await refreshUser();
  };

  const logout = async () => {
    if (user?.is_study_guest) {
      await api.logoutStudySession();
    } else {
      await api.logout();
    }
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        studyError,
        startStudySession,
        register,
        login,
        loginWithGoogle,
        completeMfaLogin,
        logout,
        refreshUser,
      }}
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
