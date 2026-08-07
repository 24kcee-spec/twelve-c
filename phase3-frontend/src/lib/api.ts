import {
  ApplyPaymentsRequest,
  Business,
  MfaRequiredResponse,
  MfaSetupResponse,
  QpdCalculationCreate,
  QpdCalculationOut,
  TokenPair,
  UserOut,
  ApiError,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://twelve-c.onrender.com";

const ACCESS_KEY = "twelvec_access_token";
const REFRESH_KEY = "twelvec_refresh_token";

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(tokens: TokenPair | null) {
  if (typeof window === "undefined") return;
  if (!tokens) {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    return;
  }
  localStorage.setItem(ACCESS_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function hasAccessToken(): boolean {
  return getAccessToken() !== null;
}

// Only one refresh should ever be in flight at a time - concurrent 401s all
// wait on the same promise instead of racing the backend with several
// refresh_token calls (which would revoke each other via rotation).
let refreshInFlight: Promise<TokenPair | null> | null = null;

async function tryRefresh(): Promise<TokenPair | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = rawRequest<TokenPair>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then((tokens) => {
        setTokens(tokens);
        return tokens;
      })
      .catch(() => {
        setTokens(null);
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

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

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
    rawRequest<TokenPair | MfaRequiredResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      true
    ),

  mfaLogin: (mfaPendingToken: string, totpCode: string) =>
    rawRequest<TokenPair>(
      "/auth/mfa/login",
      { method: "POST", body: JSON.stringify({ mfa_pending_token: mfaPendingToken, totp_code: totpCode }) },
      true
    ),

  googleAuth: (idToken: string) =>
    rawRequest<TokenPair | MfaRequiredResponse>(
      "/auth/google",
      { method: "POST", body: JSON.stringify({ id_token: idToken }) },
      true
    ),

  logout: async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await rawRequest("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }, true);
      } catch {
        // Best-effort - clear local tokens regardless of server outcome.
      }
    }
    setTokens(null);
  },

  me: () => request<UserOut>("/auth/me"),

  verifyEmail: (token: string) =>
    rawRequest<{ message: string }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }, true),

  resendVerification: (email: string) =>
    rawRequest<{ message: string }>(
      "/auth/resend-verification",
      { method: "POST", body: JSON.stringify({ email }) },
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
};
