"use client";

import React, { useEffect, useRef } from "react";

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

      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
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
  }, [clientId, onSuccess, onError, text]);

  if (!clientId) {
    return (
      <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 p-2 rounded text-center">
        Google Sign-In disabled (NEXT_PUBLIC_GOOGLE_CLIENT_ID missing).
      </div>
    );
  }

  return <div ref={containerRef} className="w-full min-h-[40px] flex justify-center" />;
};

export default GoogleSignInButton;