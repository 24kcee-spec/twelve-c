"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { api } from "./api";

interface User {
  id?: string;
  email: string;
  full_name?: string;
  is_verified?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchUser = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      let res;
      try {
        res = await api.get("/api/auth/me");
      } catch (e: any) {
        if (e?.response?.status === 404) {
          res = await api.get("/auth/me");
        } else {
          throw e;
        }
      }
      setUser(res.data);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const login = async (email: string, pass: string) => {
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", pass);

    let res;
    try {
      res = await api.post("/api/auth/login", formData, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch (e: any) {
      if (e?.response?.status === 404) {
        res = await api.post("/auth/login", formData, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } else {
        throw e;
      }
    }

    if (res.data.access_token) {
      localStorage.setItem("token", res.data.access_token);
      await fetchUser();
    }
  };

  const loginWithGoogle = async (credential: string) => {
    let res;
    try {
      res = await api.post("/api/auth/google", { credential });
    } catch (e: any) {
      if (e?.response?.status === 404) {
        res = await api.post("/auth/google", { credential });
      } else {
        throw e;
      }
    }

    if (res.data.access_token) {
      localStorage.setItem("token", res.data.access_token);
      await fetchUser();
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};