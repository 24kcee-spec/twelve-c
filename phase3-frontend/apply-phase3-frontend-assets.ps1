$path = "src/lib/types.ts"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
export interface UserOut {
  id: string;
  email: string;
  is_active: boolean;
  is_verified: boolean;
  mfa_enabled: boolean;
  has_password: boolean;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: "bearer";
}

export interface MfaRequiredResponse {
  mfa_required: true;
  mfa_pending_token: string;
}

export interface MfaSetupResponse {
  provisioning_uri: string;
  qr_code_data_uri: string;
}

export interface DeleteAccountRequest {
  password?: string;
  totp_code?: string;
}

export interface Business {
  id: string;
  name: string;
  default_exchange_rate: number;
  default_tax_rate: number;
  default_aids_levy_rate: number;
  created_at: string;
  updated_at: string;
}

export interface CurrencyExpensesIn {
  cost_of_sales: number;
  salaries: number;
  other_expenses: number;
  capital_allowances: number;
}

export const emptyExpenses = (): CurrencyExpensesIn => ({
  cost_of_sales: 0,
  salaries: 0,
  other_expenses: 0,
  capital_allowances: 0,
});

export interface QpdCalculationCreate {
  tax_year: number;
  quarter_label: string;
  quarter: number;
  usd_sales: number;
  zig_sales: number;
  usd_expenses: CurrencyExpensesIn;
  zig_expenses: CurrencyExpensesIn;
  exchange_rate?: number | null;
  tax_rate?: number | null;
  aids_levy_rate?: number | null;
  // Leave both undefined to let the backend auto-sum confirmed prior-quarter
  // payments for this business/tax_year. Only pass these to override that.
  previous_qpds_paid_usd?: number | null;
  previous_qpds_paid_zig?: number | null;

  // Prior-year assessed tax loss carried forward - reduces the taxable base
  // before tax is computed, not a credit against tax already computed.
  assessed_loss_usd?: number;
  assessed_loss_zig?: number;

  // Withholding tax already suffered this tax year (e.g. a client withheld
  // 30% for lack of an ITF263 clearance) - netted off the cumulative amount
  // due, the same way previous_qpds_paid is.
  withholding_credits_usd?: number;
  withholding_credits_zig?: number;
}

export interface QpdInstalmentOut {
  label: string;
  percentage: number;
  usd: number;
  zig: number;
  usd_paid: number;
  zig_paid: number;
  usd_balance: number;
  zig_balance: number;
}

export interface QpdResultJson {
  usd_ratio: number;
  zig_ratio: number;
  payment_ratio_usd: number;
  payment_ratio_zig: number;
  adjusted_income_usd: number;
  adjusted_income_zig: number;
  adjusted_deductions_usd: number;
  adjusted_deductions_zig: number;
  taxable_profit_usd: number;
  taxable_profit_zig: number;
  tax_payable_usd: number;
  tax_payable_zig: number;
  aids_levy_usd: number;
  aids_levy_zig: number;
  total_tax_usd: number;
  total_tax_zig: number;
  schedule: QpdInstalmentOut[];
  // The actual amount owed THIS quarter - this is the headline figure,
  // not `schedule`, which is a full-year projection at the current
  // estimate and isn't netted against what's already been paid.
  quarter: number;
  due_date: string;
  cumulative_percentage: number;
  cumulative_due_usd: number;
  cumulative_due_zig: number;
  previous_paid_usd: number;
  previous_paid_zig: number;
  net_payable_usd: number;
  net_payable_zig: number;
}

export interface QpdCalculationOut {
  id: string;
  business_id: string;
  tax_year: number;
  quarter_label: string;
  quarter: number;
  input_json: QpdCalculationCreate;
  result_json: QpdResultJson;
  actual_usd_paid: number | null;
  actual_zig_paid: number | null;
  created_at: string;
}

export interface ApplyPaymentsRequest {
  usd_paid: number[];
  zig_paid: number[];
}

export interface ConfirmActualPaymentRequest {
  actual_usd_paid: number;
  actual_zig_paid: number;
}

// --- Capital asset register ---

export type AssetCategory =
  | "commercial_building"
  | "industrial_farm_building"
  | "motor_vehicle"
  | "machinery_other";

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  commercial_building: "Commercial building (2.5% W&T)",
  industrial_farm_building: "Industrial / farm building (5% W&T)",
  motor_vehicle: "Motor vehicle (20% W&T)",
  machinery_other: "Machinery & other movable assets (10% W&T)",
};

export interface CapitalAssetCreate {
  description: string;
  category: AssetCategory;
  cost_usd: number;
  cost_zig: number;
  year_acquired: number;
  elect_sia: boolean;
}

export interface CapitalAssetOut extends CapitalAssetCreate {
  id: string;
  business_id: string;
  created_at: string;
}

export interface CapitalAllowanceTotals {
  tax_year: number;
  total_allowance_usd: number;
  total_allowance_zig: number;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : "Request failed");
    this.status = status;
    this.detail = detail;
  }
}
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "src/lib/api.ts"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
import {
  AccessTokenResponse,
  ApplyPaymentsRequest,
  Business,
  CapitalAllowanceTotals,
  CapitalAssetCreate,
  CapitalAssetOut,
  ConfirmActualPaymentRequest,
  DeleteAccountRequest,
  MfaRequiredResponse,
  MfaSetupResponse,
  QpdCalculationCreate,
  QpdCalculationOut,
  TokenPair,
  UserOut,
  ApiError,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://twelve-c.onrender.com";

// The access token now lives ONLY in memory - never in localStorage or
// sessionStorage - so it isn't readable by an injected script (XSS). The
// refresh token lives in an httpOnly cookie the browser manages on its own;
// JS never sees it at all. This means the access token doesn't survive a
// hard page refresh by itself - AuthProvider calls /auth/refresh on mount
// (which succeeds off the cookie) to get a fresh one silently.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

// Only one refresh should ever be in flight at a time - concurrent 401s all
// wait on the same promise instead of racing the backend with several
// refresh calls (which would revoke each other via rotation).
let refreshInFlight: Promise<AccessTokenResponse | null> | null = null;

async function tryRefresh(): Promise<AccessTokenResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = rawRequest<AccessTokenResponse>("/auth/refresh", { method: "POST" }, true)
      .then((tokens) => {
        setAccessToken(tokens.access_token);
        return tokens;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function rawRequest<T>(path: string, init: RequestInit = {}, skipAuth = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };

  if (!skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  // credentials: "include" is required so the browser attaches (and
  // accepts) the httpOnly refresh-token cookie on cross-site requests
  // between the Vercel frontend and the Render backend.
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
        ? (body as Record<string, unknown>).detail
        : body;
    throw new ApiError(res.status, detail);
  }

  return body as T;
}

// Wraps rawRequest with a single automatic retry-after-refresh on 401s, for
// authenticated calls only.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        return await rawRequest<T>(path, init);
      }
    }
    throw err;
  }
}

export const api = {
  // --- Auth ---
  register: (email: string, password: string) =>
    rawRequest<UserOut>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }, true),

  login: (email: string, password: string) =>
    rawRequest<TokenPair | AccessTokenResponse | MfaRequiredResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      true
    ),

  mfaLogin: (mfaPendingToken: string, totpCode: string) =>
    rawRequest<AccessTokenResponse>(
      "/auth/mfa/login",
      { method: "POST", body: JSON.stringify({ mfa_pending_token: mfaPendingToken, totp_code: totpCode }) },
      true
    ),

  googleAuth: (idToken: string) =>
    rawRequest<TokenPair | AccessTokenResponse | MfaRequiredResponse>(
      "/auth/google",
      { method: "POST", body: JSON.stringify({ id_token: idToken }) },
      true
    ),

  refresh: () => rawRequest<AccessTokenResponse>("/auth/refresh", { method: "POST" }, true),

  logout: async () => {
    try {
      await rawRequest("/auth/logout", { method: "POST" }, true);
    } catch {
      // Best-effort - clear the in-memory token regardless of server outcome.
    }
    setAccessToken(null);
  },

  me: () => request<UserOut>("/auth/me"),

  deleteAccount: (payload: DeleteAccountRequest) =>
    request<void>("/auth/me", { method: "DELETE", body: JSON.stringify(payload) }),

  verifyEmail: (email: string, code: string) =>
    rawRequest<{ message: string }>(
      "/auth/verify-email",
      { method: "POST", body: JSON.stringify({ email, code }) },
      true
    ),

  resendVerification: (email: string) =>
    rawRequest<{ message: string }>(
      "/auth/resend-verification",
      { method: "POST", body: JSON.stringify({ email }) },
      true
    ),

  forgotPassword: (email: string) =>
    rawRequest<{ message: string }>(
      "/auth/forgot-password",
      { method: "POST", body: JSON.stringify({ email }) },
      true
    ),

  resetPassword: (email: string, code: string, newPassword: string) =>
    rawRequest<{ message: string }>(
      "/auth/reset-password",
      { method: "POST", body: JSON.stringify({ email, code, new_password: newPassword }) },
      true
    ),

  // --- MFA management (authenticated) ---
  mfaSetup: () => request<MfaSetupResponse>("/auth/mfa/setup", { method: "POST" }),
  mfaVerify: (code: string) =>
    request<{ mfa_enabled: boolean }>("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ totp_code: code }) }),
  mfaDisable: (code: string) =>
    request<{ mfa_enabled: boolean }>("/auth/mfa/disable", { method: "POST", body: JSON.stringify({ totp_code: code }) }),

  // --- Businesses ---
  listBusinesses: () => request<Business[]>("/businesses"),
  createBusiness: (payload: Partial<Business> & { name: string }) =>
    request<Business>("/businesses", { method: "POST", body: JSON.stringify(payload) }),
  getBusiness: (id: string) => request<Business>(`/businesses/${id}`),
  deleteBusiness: (id: string) => request<void>(`/businesses/${id}`, { method: "DELETE" }),

  updateBusiness: (
    id: string,
    payload: Partial<{
      name: string;
      default_exchange_rate: number;
      default_tax_rate: number;
      default_aids_levy_rate: number;
    }>
  ) => request<Business>(`/businesses/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // --- QPD calculations ---
  listCalculations: (businessId: string) =>
    request<QpdCalculationOut[]>(`/businesses/${businessId}/qpd-calculations`),
  createCalculation: (businessId: string, payload: QpdCalculationCreate) =>
    request<QpdCalculationOut>(`/businesses/${businessId}/qpd-calculations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  applyPayments: (businessId: string, calculationId: string, payload: ApplyPaymentsRequest) =>
    request<QpdCalculationOut>(`/businesses/${businessId}/qpd-calculations/${calculationId}/payments`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  // Records what was genuinely paid to ZIMRA for a quarter - the next
  // quarter's calculation auto-sums this (not the seeded estimate) to
  // work out what's actually still owed.
  confirmActualPayment: (businessId: string, calculationId: string, payload: ConfirmActualPaymentRequest) =>
    request<QpdCalculationOut>(`/businesses/${businessId}/qpd-calculations/${calculationId}/confirm-payment`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteCalculation: (businessId: string, calculationId: string) =>
    request<void>(`/businesses/${businessId}/qpd-calculations/${calculationId}`, { method: "DELETE" }),

  // --- Capital asset register ---
  listAssets: (businessId: string) => request<CapitalAssetOut[]>(`/businesses/${businessId}/assets`),
  createAsset: (businessId: string, payload: CapitalAssetCreate) =>
    request<CapitalAssetOut>(`/businesses/${businessId}/assets`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteAsset: (businessId: string, assetId: string) =>
    request<void>(`/businesses/${businessId}/assets/${assetId}`, { method: "DELETE" }),
  getAllowanceTotals: (businessId: string, taxYear: number) =>
    request<CapitalAllowanceTotals>(`/businesses/${businessId}/assets/allowance?tax_year=${taxYear}`),
};
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "src/components/AssetRegister.tsx"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
"use client";

import { api } from "@/lib/api";
import { ASSET_CATEGORY_LABELS, AssetCategory, CapitalAssetOut } from "@/lib/types";
import { useEffect, useState } from "react";
import { Button, Field, TrashIcon } from "./ui";

const CATEGORY_OPTIONS = Object.entries(ASSET_CATEGORY_LABELS) as [AssetCategory, string][];

/**
 * Collapsible capital asset register for one business. Assets persist
 * across tax years (acquired once, claimed against year after year), so
 * this lives independently of any single calculation - `taxYear` just
 * controls which year's allowance total is displayed and offered up via
 * `onApply`. Nothing is written into the calculation automatically; see
 * capital_allowances.py's module docstring for why.
 */
export function AssetRegister({
  businessId,
  taxYear,
  onApply,
}: {
  businessId: string;
  taxYear: number;
  onApply: (usd: number, zig: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<CapitalAssetOut[]>([]);
  const [totals, setTotals] = useState<{ usd: number; zig: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<AssetCategory>("machinery_other");
  const [costUsd, setCostUsd] = useState(0);
  const [costZig, setCostZig] = useState(0);
  const [yearAcquired, setYearAcquired] = useState(taxYear);
  const [electSia, setElectSia] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [assetList, allowance] = await Promise.all([
        api.listAssets(businessId),
        api.getAllowanceTotals(businessId, taxYear),
      ]);
      setAssets(assetList);
      setTotals({ usd: allowance.total_allowance_usd, zig: allowance.total_allowance_zig });
    } catch {
      setError("Couldn't load the asset register.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, taxYear]);

  async function handleAdd() {
    if (!description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createAsset(businessId, {
        description: description.trim(),
        category,
        cost_usd: costUsd,
        cost_zig: costZig,
        year_acquired: yearAcquired,
        elect_sia: electSia,
      });
      setDescription("");
      setCostUsd(0);
      setCostZig(0);
      setElectSia(false);
      setShowForm(false);
      await refresh();
    } catch {
      setError("Couldn't save that asset.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assetId: string) {
    try {
      await api.deleteAsset(businessId, assetId);
      await refresh();
    } catch {
      setError("Couldn't remove that asset.");
    }
  }

  return (
    <div className="rounded border border-line px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-soft"
      >
        <span>
          Asset register
          <span className="ml-2 font-mono text-xs font-normal text-ink-faint">SIA / wear &amp; tear</span>
        </span>
        <span className="text-ink-faint">{open ? "Hide" : "Manage"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <p className="text-xs text-ink-faint">
            Track fixed assets once here and this works out the Special Initial Allowance or wear &amp;
            tear claimable for {taxYear} - a running tally, not a one-off entry. Add it to this
            calculation&apos;s capital allowances whenever it&apos;s ready.
          </p>

          {loading && <p className="text-xs text-ink-faint">Loading register...</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {!loading && assets.length > 0 && (
            <ul className="space-y-1">
              {assets.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-ink">{a.description}</p>
                    <p className="truncate text-xs text-ink-faint">
                      {ASSET_CATEGORY_LABELS[a.category]} - {a.year_acquired}
                      {a.elect_sia ? " - SIA elected" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-ink-soft">
                      {a.cost_usd > 0 ? `$${a.cost_usd.toLocaleString()}` : ""}
                      {a.cost_usd > 0 && a.cost_zig > 0 ? " / " : ""}
                      {a.cost_zig > 0 ? `Z${a.cost_zig.toLocaleString()}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="text-ink-faint hover:text-red-600"
                      aria-label={`Remove ${a.description}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && assets.length === 0 && (
            <p className="text-xs text-ink-faint">No assets on the register yet.</p>
          )}

          {totals && (
            <div className="flex items-center justify-between rounded bg-surface-soft px-2 py-1.5 text-sm">
              <span className="text-ink-soft">Claimable for {taxYear}</span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs tabular-nums text-usd">
                  ${totals.usd.toLocaleString()}
                </span>
                <span className="font-mono text-xs tabular-nums text-zig">
                  Z{totals.zig.toLocaleString()}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => onApply(totals.usd, totals.zig)}
                  disabled={totals.usd === 0 && totals.zig === 0}
                >
                  Apply to calculation
                </Button>
              </div>
            </div>
          )}

          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="text-xs font-medium text-usd hover:underline"
            >
              + Add asset
            </button>
          ) : (
            <div className="space-y-2 rounded border border-line p-2">
              <Field
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Delivery van"
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink-soft">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AssetCategory)}
                  className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-usd"
                >
                  {CATEGORY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Cost (USD)"
                  type="number"
                  min={0}
                  step="0.01"
                  emptyIfZero
                  value={costUsd}
                  onChange={(e) => setCostUsd(parseFloat(e.target.value) || 0)}
                />
                <Field
                  label="Cost (ZiG)"
                  type="number"
                  min={0}
                  step="0.01"
                  emptyIfZero
                  value={costZig}
                  onChange={(e) => setCostZig(parseFloat(e.target.value) || 0)}
                />
              </div>
              <Field
                label="Year acquired"
                type="number"
                min={2000}
                max={2100}
                value={yearAcquired}
                onChange={(e) => setYearAcquired(parseInt(e.target.value, 10) || taxYear)}
              />
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={electSia} onChange={(e) => setElectSia(e.target.checked)} />
                Elect Special Initial Allowance (25%/yr for 4 years) instead of wear &amp; tear
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={handleAdd}
                  disabled={saving || !description.trim()}
                >
                  {saving ? "Saving..." : "Save asset"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "src/app/dashboard/[businessId]/page.tsx"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AssetRegister } from "@/components/AssetRegister";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PaymentTracker } from "@/components/PaymentTracker";
import { NextPaymentDue } from "@/components/NextPaymentDue";
import { downloadTaxSummaryPdf } from "@/lib/generatePdf";
import { Badge, Button, Card, ChevronDown, ErrorNote, Eyebrow, Field, TrashIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, money } from "@/lib/format";
import { Business, emptyExpenses, QpdCalculationOut, CurrencyExpensesIn } from "@/lib/types";

function BusinessContent({ businessId }: { businessId: string }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [calculations, setCalculations] = useState<QpdCalculationOut[]>([]);
  const [selected, setSelected] = useState<QpdCalculationOut | null>(null);
  const [error, setError] = useState("");

  // History grouping/delete state. Years start collapsed except the most
  // recent one, which is expanded the first time calculations load.
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const yearsInitialized = useRef(false);
  const [confirmingDeleteCalcId, setConfirmingDeleteCalcId] = useState<string | null>(null);
  const [deletingCalcId, setDeletingCalcId] = useState<string | null>(null);

  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [quarterLabel, setQuarterLabel] = useState("Annual estimate");
  // Which QPD this run is FOR (1=25 Mar, 2=25 Jun, 3=25 Sep, 4=20 Dec) -
  // drives the engine's cumulative net_payable, not just the schedule
  // projection. Must be sent on every create - the backend defaults to 1
  // when omitted, which silently mis-files anything past Q1 if this isn't wired up.
  const [quarter, setQuarter] = useState(1);
  const [usdSales, setUsdSales] = useState(0);
  const [zigSales, setZigSales] = useState(0);
  const [usdExpenses, setUsdExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [zigExpenses, setZigExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [calculating, setCalculating] = useState(false);

  // Optional annual adjustments - assessed loss b/f reduces the taxable
  // base; withholding credits net off the cumulative amount due. Both
  // default to 0, which reproduces identical results to before these existed.
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [assessedLossUsd, setAssessedLossUsd] = useState(0);
  const [assessedLossZig, setAssessedLossZig] = useState(0);
  const [withholdingCreditsUsd, setWithholdingCreditsUsd] = useState(0);
  const [withholdingCreditsZig, setWithholdingCreditsZig] = useState(0);

  // Rate overrides - default to the business's saved rates, but editable per
  // calculation since ZIMRA rates and the exchange rate both change during the year.
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [taxRatePct, setTaxRatePct] = useState<number | null>(null);
  const [aidsLevyPct, setAidsLevyPct] = useState<number | null>(null);
  const [showRateSettings, setShowRateSettings] = useState(false);

  async function loadAll() {
    try {
      const [b, calcs] = await Promise.all([
        api.getBusiness(businessId),
        api.listCalculations(businessId),
      ]);
      setBusiness(b);
      setExchangeRate(b.default_exchange_rate);
      setTaxRatePct(b.default_tax_rate * 100);
      setAidsLevyPct(b.default_aids_levy_rate * 100);
      setCalculations(calcs);
      if (calcs.length > 0) setSelected(calcs[0]);
      if (!yearsInitialized.current && calcs.length > 0) {
        setExpandedYears(new Set([calcs[0].tax_year]));
        yearsInitialized.current = true;
      }
    } catch {
      setError("Couldn't load this business.");
    }
  }

  useEffect(() => {
    // Next.js reuses this component instance when navigating between
    // businesses via the switcher (only the [businessId] param changes,
    // no remount) - reset per-business UI state explicitly or it would
    // leak across businesses.
    yearsInitialized.current = false;
    setExpandedYears(new Set());
    setConfirmingDeleteCalcId(null);
    setDeletingCalcId(null);
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // Calculations are already ordered by the API (tax_year desc, created_at
  // desc), so same-year entries are contiguous - safe to fold into groups
  // in a single pass without re-sorting on the client.
  const groupedCalculations = useMemo(() => {
    const groups: { year: number; items: QpdCalculationOut[] }[] = [];
    for (const c of calculations) {
      const current = groups[groups.length - 1];
      if (current && current.year === c.tax_year) current.items.push(c);
      else groups.push({ year: c.tax_year, items: [c] });
    }
    return groups;
  }, [calculations]);

  const latestCalculationId = calculations[0]?.id ?? null;

  function toggleYear(year: number) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  async function onDeleteCalculation(calc: QpdCalculationOut) {
    setDeletingCalcId(calc.id);
    setError("");
    try {
      await api.deleteCalculation(businessId, calc.id);
      setCalculations((prev) => {
        const next = prev.filter((c) => c.id !== calc.id);
        if (selected?.id === calc.id) setSelected(next[0] ?? null);
        return next;
      });
      setConfirmingDeleteCalcId(null);
    } catch {
      setError("Couldn't delete that calculation. Try again in a moment.");
    } finally {
      setDeletingCalcId(null);
    }
  }

  function updateExpense(
    which: "usd" | "zig",
    field: keyof CurrencyExpensesIn,
    value: number
  ) {
    if (which === "usd") setUsdExpenses((prev) => ({ ...prev, [field]: value }));
    else setZigExpenses((prev) => ({ ...prev, [field]: value }));
  }

  async function onCalculate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCalculating(true);
    try {
      const result = await api.createCalculation(businessId, {
        tax_year: taxYear,
        quarter_label: quarterLabel,
        quarter,
        usd_sales: usdSales,
        zig_sales: zigSales,
        usd_expenses: usdExpenses,
        zig_expenses: zigExpenses,
        exchange_rate: exchangeRate,
        tax_rate: taxRatePct !== null ? taxRatePct / 100 : null,
        aids_levy_rate: aidsLevyPct !== null ? aidsLevyPct / 100 : null,
        assessed_loss_usd: assessedLossUsd,
        assessed_loss_zig: assessedLossZig,
        withholding_credits_usd: withholdingCreditsUsd,
        withholding_credits_zig: withholdingCreditsZig,
      });
      // Re-fetch rather than prepend locally: the list must stay ordered by
      // (tax_year desc, created_at desc) for the year-grouping above to
      // stay correct, and a blind prepend would break that if the user
      // calculates for an earlier tax year than what's already showing.
      const refreshed = await api.listCalculations(businessId);
      setCalculations(refreshed);
      setSelected(result);
      setExpandedYears((prev) => new Set(prev).add(result.tax_year));
    } catch {
      setError("Couldn't run that calculation. Check the figures and try again.");
    } finally {
      setCalculating(false);
    }
  }

  async function onSavePayments(usdPaid: number[], zigPaid: number[]) {
    if (!selected) return;
    const updated = await api.applyPayments(businessId, selected.id, {
      usd_paid: usdPaid,
      zig_paid: zigPaid,
    });
    setSelected(updated);
    setCalculations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  if (!business) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar />
        <div className="mx-auto max-w-5xl px-6 py-12">
          <ErrorNote>{error}</ErrorNote>
          {!error && <p className="text-sm text-ink-faint">Loading...</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Eyebrow>Business</Eyebrow>
        <h1 className="mt-1 font-display text-3xl text-ink">{business.name}</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Default rate ZiG {business.default_exchange_rate} / USD MIDDOTTOKEN {(business.default_tax_rate * 100).toFixed(0)}% tax
          + {(business.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
        </p>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <Eyebrow>New QPD calculation</Eyebrow>
              <form className="mt-4 space-y-4" onSubmit={onCalculate}>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Tax year"
                    type="number"
                    required
                    value={taxYear}
                    onChange={(e) => setTaxYear(parseInt(e.target.value, 10) || taxYear)}
                  />
                  <Field
                    label="Label"
                    required
                    value={quarterLabel}
                    onChange={(e) => setQuarterLabel(e.target.value)}
                    hint="e.g. 'Q3 re-estimate'"
                  />
                </div>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink-soft">QPD quarter</span>
                  <select
                    value={quarter}
                    onChange={(e) => setQuarter(parseInt(e.target.value, 10))}
                    className="w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-usd"
                  >
                    <option value={1}>QPD1 - due 25 March (10% cumulative)</option>
                    <option value={2}>QPD2 - due 25 June (35% cumulative)</option>
                    <option value={3}>QPD3 - due 25 September (65% cumulative)</option>
                    <option value={4}>QPD4 - due 20 December (100% cumulative)</option>
                  </select>
                  <span className="mt-1 block text-xs text-ink-faint">
                    Which QPD you&apos;re filing for - the amount actually due nets this quarter&apos;s
                    cumulative target against what you&apos;ve confirmed paying in earlier quarters.
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="USD sales"
                    type="number"
                    step="0.01"
                    min={0}
                    emptyIfZero
                    value={usdSales}
                    onChange={(e) => setUsdSales(parseFloat(e.target.value) || 0)}
                  />
                  <Field
                    label="ZiG sales"
                    type="number"
                    step="0.01"
                    min={0}
                    emptyIfZero
                    value={zigSales}
                    onChange={(e) => setZigSales(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div>
                  <p className="mb-1 text-sm font-medium text-ink-soft">Deductions</p>
                  <div className="rounded border border-line px-3">
                    <CurrencyPairInput
                      label="Cost of sales"
                      usdValue={usdExpenses.cost_of_sales}
                      zigValue={zigExpenses.cost_of_sales}
                      onUsdChange={(v) => updateExpense("usd", "cost_of_sales", v)}
                      onZigChange={(v) => updateExpense("zig", "cost_of_sales", v)}
                    />
                    <CurrencyPairInput
                      label="Salaries"
                      usdValue={usdExpenses.salaries}
                      zigValue={zigExpenses.salaries}
                      onUsdChange={(v) => updateExpense("usd", "salaries", v)}
                      onZigChange={(v) => updateExpense("zig", "salaries", v)}
                    />
                    <CurrencyPairInput
                      label="Other expenses"
                      usdValue={usdExpenses.other_expenses}
                      zigValue={zigExpenses.other_expenses}
                      onUsdChange={(v) => updateExpense("usd", "other_expenses", v)}
                      onZigChange={(v) => updateExpense("zig", "other_expenses", v)}
                    />
                    <CurrencyPairInput
                      label="Capital allowances"
                      usdValue={usdExpenses.capital_allowances}
                      zigValue={zigExpenses.capital_allowances}
                      onUsdChange={(v) => updateExpense("usd", "capital_allowances", v)}
                      onZigChange={(v) => updateExpense("zig", "capital_allowances", v)}
                    />
                  </div>
                </div>

                <AssetRegister
                  businessId={businessId}
                  taxYear={taxYear}
                  onApply={(usd, zig) => {
                    updateExpense("usd", "capital_allowances", usd);
                    updateExpense("zig", "capital_allowances", zig);
                  }}
                />

                <div className="rounded border border-line px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowRateSettings((s) => !s)}
                    className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-soft"
                  >
                    <span>
                      Rate settings
                      <span className="ml-2 font-mono text-xs font-normal text-ink-faint">
                        ZiG {exchangeRate ?? "-"}/USD - {taxRatePct ?? "-"}% tax + {aidsLevyPct ?? "-"}% AIDS levy
                      </span>
                    </span>
                    <span className="text-ink-faint">{showRateSettings ? "Hide" : "Edit"}</span>
                  </button>

                  {showRateSettings && (
                    <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
                      <Field
                        label="Exchange rate"
                        type="number"
                        step="0.01"
                        min={0}
                        hint="ZiG per USD"
                        value={exchangeRate ?? ""}
                        onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                      />
                      <Field
                        label="Tax rate"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        hint="% of taxable profit"
                        value={taxRatePct ?? ""}
                        onChange={(e) => setTaxRatePct(parseFloat(e.target.value) || 0)}
                      />
                      <Field
                        label="AIDS levy"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        hint="% of tax payable"
                        value={aidsLevyPct ?? ""}
                        onChange={(e) => setAidsLevyPct(parseFloat(e.target.value) || 0)}
                      />
                      <p className="col-span-3 text-xs text-ink-faint">
                        These carry over from this business&apos;s saved defaults. Change them here for a
                        one-off recalculation (e.g. a new ZIMRA budget rate) without editing the business
                        itself.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded border border-line px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowAdjustments((s) => !s)}
                    className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-soft"
                  >
                    <span>
                      Adjustments
                      {(assessedLossUsd > 0 || assessedLossZig > 0 || withholdingCreditsUsd > 0 || withholdingCreditsZig > 0) && (
                        <span className="ml-2 font-mono text-xs font-normal text-ink-faint">active</span>
                      )}
                    </span>
                    <span className="text-ink-faint">{showAdjustments ? "Hide" : "Edit"}</span>
                  </button>

                  {showAdjustments && (
                    <div className="mt-3 space-y-1 border-t border-line pt-3">
                      <CurrencyPairInput
                        label="Assessed loss b/f"
                        usdValue={assessedLossUsd}
                        zigValue={assessedLossZig}
                        onUsdChange={setAssessedLossUsd}
                        onZigChange={setAssessedLossZig}
                      />
                      <CurrencyPairInput
                        label="Withholding tax credits"
                        usdValue={withholdingCreditsUsd}
                        zigValue={withholdingCreditsZig}
                        onUsdChange={setWithholdingCreditsUsd}
                        onZigChange={setWithholdingCreditsZig}
                      />
                      <p className="pt-2 text-xs text-ink-faint">
                        Assessed loss reduces the taxable base before tax is computed. Withholding
                        credits (e.g. 30% withheld by a client for lack of an ITF263 clearance) are
                        netted off the amount still due this quarter, same as a confirmed payment.
                      </p>
                    </div>
                  )}
                </div>

                <ErrorNote>{error}</ErrorNote>
                <Button type="submit" variant="primary" disabled={calculating}>
                  {calculating ? "Calculating..." : "Calculate QPD"}
                </Button>
              </form>
            </Card>

            <Card>
              <div className="flex items-center justify-between">
                <Eyebrow>History</Eyebrow>
                {calculations.length > 0 && (
                  <span className="font-mono text-xs text-ink-faint">
                    {calculations.length} {calculations.length === 1 ? "entry" : "entries"}
                  </span>
                )}
              </div>

              {calculations.length === 0 && (
                <p className="mt-2 text-sm text-ink-faint">No calculations yet.</p>
              )}

              <div className="mt-3 space-y-2">
                {groupedCalculations.map((group) => {
                  const isExpanded = expandedYears.has(group.year);
                  return (
                    <div key={group.year} className="overflow-hidden rounded border border-line">
                      <button
                        type="button"
                        onClick={() => toggleYear(group.year)}
                        aria-expanded={isExpanded}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left transition ${
                          isExpanded ? "bg-paper" : "bg-surface hover:bg-paper"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-display text-base text-ink">{group.year}</span>
                          <span className="rounded-full bg-ink-faint/15 px-2 py-0.5 font-mono text-[10px] text-ink-faint">
                            {group.items.length}
                          </span>
                        </span>
                        <ChevronDown open={isExpanded} />
                      </button>

                      {isExpanded && (
                        <ul className="space-y-1 border-t border-line p-2">
                          {group.items.map((c) => {
                            const isSelected = selected?.id === c.id;
                            const isLatest = c.id === latestCalculationId;
                            const isConfirming = confirmingDeleteCalcId === c.id;

                            if (isConfirming) {
                              return (
                                <li key={c.id}>
                                  <div className="flex items-center justify-between gap-2 rounded bg-danger-soft px-3 py-2">
                                    <span className="text-xs text-danger">
                                      Delete this calculation? This can&apos;t be undone.
                                    </span>
                                    <div className="flex shrink-0 gap-2">
                                      <button
                                        type="button"
                                        onClick={() => onDeleteCalculation(c)}
                                        disabled={deletingCalcId === c.id}
                                        className="rounded bg-danger px-2 py-1 text-xs font-semibold text-paper disabled:opacity-50"
                                      >
                                        {deletingCalcId === c.id ? "Deleting..." : "Yes, delete"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmingDeleteCalcId(null)}
                                        className="rounded border border-line px-2 py-1 text-xs text-ink-soft"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              );
                            }

                            return (
                              <li key={c.id}>
                                <div
                                  className={`flex items-center gap-1 rounded text-sm transition ${
                                    isSelected ? "bg-usd-soft text-usd" : "text-ink-soft hover:bg-paper hover:text-ink"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSelected(c)}
                                    className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
                                  >
                                    <span className="flex min-w-0 flex-col items-start">
                                      <span className="flex items-center gap-2">
                                        <span className="truncate">{c.quarter_label}</span>
                                        {isLatest && <Badge>Latest</Badge>}
                                        {isSelected && <Badge variant="outline">Viewing</Badge>}
                                      </span>
                                      <span className="mt-0.5 font-mono text-[11px] text-ink-faint">
                                        {formatDateTime(c.created_at)}
                                      </span>
                                    </span>
                                    <span className="shrink-0 font-mono tabular-nums">
                                      {money(c.result_json.total_tax_usd, "USD")}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingDeleteCalcId(c.id)}
                                    aria-label="Delete calculation"
                                    className="mr-1.5 shrink-0 rounded p-1.5 text-ink-faint/60 transition hover:bg-danger-soft hover:text-danger"
                                  >
                                    <TrashIcon />
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            {selected ? (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => downloadTaxSummaryPdf(business, selected)}
                  >
                    Download PDF summary
                  </Button>
                </div>
                <NextPaymentDue calculation={selected} />
                <ResultsPanel result={selected.result_json} taxYear={selected.tax_year} />
                <PaymentTracker key={selected.id} calculation={selected} onSubmit={onSavePayments} />
              </>
            ) : (
              <Card>
                <p className="text-sm text-ink-faint">
                  Run a calculation on the left to see the breakdown and schedule here.
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function BusinessPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params.businessId;

  return (
    <AuthGuard>
      <BusinessContent businessId={businessId} />
    </AuthGuard>
  );
}
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
