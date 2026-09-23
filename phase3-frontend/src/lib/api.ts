import {
  AccessTokenResponse,
  Business,
  BusinessCompliance,
  CapitalAllowanceTotals,
  CapitalAssetCreate,
  CapitalAssetOut,
  ConfirmActualPaymentRequest,
  DeleteAccountRequest,
  MfaRequiredResponse,
  MfaSetupResponse,
  MonthlyIncomeEntry,
  MonthlyIncomeEntryOut,
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

// Blob-downloading counterpart to `request` - same auth-header/401-refresh
// handling, but for endpoints that return a binary file (xlsx/pdf) rather
// than JSON. Reads the filename off Content-Disposition so the browser's
// save dialog offers the same name the server chose (business + tax year),
// instead of a generic path-derived one.
async function rawDownload(path: string, skipAuth = false): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  if (!skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, { headers, credentials: "include" });

  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      // Non-JSON error body (unlikely for these endpoints) - fall back to status text.
    }
    throw new ApiError(res.status, (detail as { detail?: unknown })?.detail ?? res.statusText);
  }

  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "download";
  const blob = await res.blob();
  return { blob, filename };
}

async function downloadFile(path: string): Promise<{ blob: Blob; filename: string }> {
  try {
    return await rawDownload(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        return await rawDownload(path);
      }
    }
    throw err;
  }
}

// Triggers the browser's own "Save As" flow for a blob, without navigating
// away from the app - the standard hidden-anchor-click trick.
function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

  // --- Monthly rolling income ---
  getMonthlyIncome: (businessId: string, taxYear: number) =>
    request<MonthlyIncomeEntryOut[]>(`/businesses/${businessId}/monthly-income/${taxYear}`),
  saveMonthlyIncome: (businessId: string, taxYear: number, entries: MonthlyIncomeEntry[]) =>
    request<MonthlyIncomeEntryOut[]>(`/businesses/${businessId}/monthly-income/${taxYear}`, {
      method: "PUT",
      body: JSON.stringify({ tax_year: taxYear, entries }),
    }),

  // --- Year-end reconciliation (Section 72(11) accuracy check) ---
  getCompliance: (businessId: string, taxYear: number) =>
    request<BusinessCompliance>(`/businesses/${businessId}/compliance?tax_year=${taxYear}`),

  // --- Working Papers exports (live-formula Excel + professional PDF) ---
  downloadWorkingPapersExcel: async (businessId: string, taxYear: number) => {
    const { blob, filename } = await downloadFile(`/businesses/${businessId}/export/excel?tax_year=${taxYear}`);
    triggerBrowserDownload(blob, filename);
  },
  downloadWorkingPapersPdf: async (businessId: string, taxYear: number) => {
    const { blob, filename } = await downloadFile(`/businesses/${businessId}/export/pdf?tax_year=${taxYear}`);
    triggerBrowserDownload(blob, filename);
  },
};