"use client";

import type { Business, QpdCalculationOut } from "@/lib/types";

export const STUDY_STORAGE_KEY = "twelvec_study_mode_v1";

export interface StudyCalculation extends QpdCalculationOut {
  payment_confirmed_at: string | null;
}

export interface StudyState {
  version: 1;
  business: Business | null;
  calculations: StudyCalculation[];
}

export const EMPTY_STUDY_STATE: StudyState = {
  version: 1,
  business: null,
  calculations: [],
};

export function readStudyState(): StudyState {
  try {
    const raw = window.localStorage.getItem(STUDY_STORAGE_KEY);
    if (!raw) return EMPTY_STUDY_STATE;
    const parsed = JSON.parse(raw) as Partial<StudyState>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.calculations) ||
      (parsed.business !== null && typeof parsed.business !== "object")
    ) {
      return EMPTY_STUDY_STATE;
    }
    return {
      version: 1,
      business: (parsed.business as Business | null) ?? null,
      calculations: parsed.calculations as StudyCalculation[],
    };
  } catch {
    return EMPTY_STUDY_STATE;
  }
}

export function writeStudyState(state: StudyState): void {
  try {
    window.localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new Error(
      "This browser could not save the study data. Check available browser storage or use another browser/device."
    );
  }
}

export function clearStudyState(): void {
  window.localStorage.removeItem(STUDY_STORAGE_KEY);
}

export function createLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sumConfirmedPriorPayments(
  calculations: StudyCalculation[],
  taxYear: number,
  quarter: number
): { usd: number; zig: number } {
  return calculations
    .filter(
      (item) =>
        item.tax_year === taxYear &&
        item.quarter < quarter &&
        item.payment_confirmed_at !== null
    )
    .reduce(
      (totals, item) => ({
        usd: totals.usd + (item.actual_usd_paid ?? 0),
        zig: totals.zig + (item.actual_zig_paid ?? 0),
      }),
      { usd: 0, zig: 0 }
    );
}
