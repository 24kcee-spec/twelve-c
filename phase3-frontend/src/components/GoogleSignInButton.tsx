"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/types";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/**
 * Renders Google's own "Continue with Google" button. Does nothing (renders
 * nothing) if NEXT_PUBLIC_GOOGLE_CLIENT_ID isn't set, so the app still works
 * fine before Google sign-in is configured.
 */
export function GoogleSignInButton({ onError }: { onError?: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { googleLogin } = useAuth();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    async function handleCredential(response: { credential: string }) {
      try {
        const result = await googleLogin(response.credential);
        if (result.mfaRequired && result.pendingToken) {
          window.sessionStorage.setItem("twelvec_mfa_pending", result.pendingToken);
          router.push("/mfa");
        } else {
          router.push("/dashboard");
        }
      } catch (err) {
        onError?.(
          err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Google sign-in failed."
        );
      }
    }

    function tryInit() {
      if (cancelled || !window.google || !containerRef.current) return false;
      window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
      });
      return true;
    }

    if (!tryInit()) {
      poll = setInterval(() => {
        if (tryInit() && poll) clearInterval(poll);
      }, 200);
    }

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [clientId, googleLogin, router, onError]);

  if (!clientId) return null;

  return <div ref={containerRef} className="flex justify-center" />;
}
