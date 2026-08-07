"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/types";
import GoogleSignInButton from "@/components/GoogleSignInButton";

export default function LoginPage() {
  const router = useRouter();
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errorMessage = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      if (typeof err.detail === "string") return err.detail;
      if (Array.isArray(err.detail)) return err.detail.map((d: { msg?: string }) => d.msg).join(" ");
    }
    return fallback;
  };

  const goAfterAuth = (mfaRequired: boolean) => {
    router.push(mfaRequired ? "/mfa" : "/dashboard");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { mfaRequired } = await login(email, password);
      goAfterAuth(mfaRequired);
    } catch (err) {
      setError(errorMessage(err, "Failed to log in."));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credential: string) => {
    setError(null);
    setLoading(true);
    try {
      const { mfaRequired } = await loginWithGoogle(credential);
      goAfterAuth(mfaRequired);
    } catch (err) {
      setError(errorMessage(err, "Google Sign-In failed on server."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-[#f7f8f6] px-4">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
        <h1 className="text-2xl font-semibold text-center text-neutral-900 mb-2">Welcome back</h1>
        <p className="text-sm text-neutral-500 text-center mb-6">Log in to your businesses.</p>

        {error && (
          <div className="mb-4 p-3 rounded text-sm text-red-600 bg-red-50 border border-red-200">
            {error}
          </div>
        )}

        <div className="mb-6">
          <GoogleSignInButton
            onSuccess={handleGoogleSuccess}
            onError={() => setError("Google Sign-In failed to connect.")}
          />
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-xs uppercase text-neutral-400 font-medium">OR</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-emerald-900 text-white rounded-md font-medium hover:bg-emerald-800 disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Need an account?{" "}
          <Link href="/register" className="text-emerald-700 font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
