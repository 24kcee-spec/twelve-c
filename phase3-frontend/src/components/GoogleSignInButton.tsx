"use client";

import React, { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme-context";

declare global {
  interface Window {
    google?: any;
  }
}

interface GoogleSignInButtonProps {
  onSuccess?: (credential: string) => void;
  onError?: (error: any) => void;
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onSuccess,
  onError,
  text = "continue_with",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!clientId || !containerRef.current) return;

    let cancelled = false;

    const handleCredential = (response: any) => {
      if (response?.credential) {
        if (onSuccess) {
          onSuccess(response.credential);
        }
      } else if (onError) {
        onError(new Error("No credential returned from Google Sign-In"));
      }
    };

    function tryInit() {
      if (
        cancelled ||
        !window.google?.accounts?.id ||
        !containerRef.current ||
        !clientId
      ) {
        return false;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
      });

      containerRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: resolvedTheme === "dark" ? "filled_black" : "outline",
        size: "large",
        text,
        width: "100%",
      });

      return true;
    }

    if (!tryInit()) {
      const interval = setInterval(() => {
        if (tryInit()) {
          clearInterval(interval);
        }
      }, 300);

      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [clientId, onSuccess, onError, text, resolvedTheme]);

  if (!clientId) {
    return (
      <div className="rounded border border-zig/40 bg-zig-soft p-2 text-center text-xs text-zig">
        Google Sign-In disabled (NEXT_PUBLIC_GOOGLE_CLIENT_ID missing).
      </div>
    );
  }

  return <div ref={containerRef} className="w-full min-h-[40px] flex justify-center" />;
};

export default GoogleSignInButton;