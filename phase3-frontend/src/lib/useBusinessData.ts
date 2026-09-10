"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Business } from "@/lib/types";

export function useBusinessData(businessId: string) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusiness(null);
    setError("");
    setLoading(true);

    api
      .getBusiness(businessId)
      .then((b) => {
        if (!cancelled) setBusiness(b);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this business.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return { business, error, loading };
}