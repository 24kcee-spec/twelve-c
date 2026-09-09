"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Business, QpdCalculationOut } from "@/lib/types";

/**
 * Single fetch path for "everything about this business" - shared between
 * the Overview route and the New Calculation route so a business's data
 * (its default rates, its calculation history) is fetched and refreshed
 * exactly one way regardless of which screen you're on. Previously this
 * lived duplicated inline in one giant page component; splitting the form
 * onto its own route made a shared hook the right seam to cut along.
 */
export function useBusinessData(businessId: string) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [calculations, setCalculations] = useState<QpdCalculationOut[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [b, calcs] = await Promise.all([
        api.getBusiness(businessId),
        api.listCalculations(businessId),
      ]);
      setBusiness(b);
      setCalculations(calcs);
      setError("");
      return calcs;
    } catch {
      setError("Couldn't load this business.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  return { business, calculations, setCalculations, error, loading, reload };
}
