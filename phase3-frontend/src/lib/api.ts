import {
  ApiError,
  ApplyPaymentsRequest,
  Business,
  MfaRequiredResponse,
  MfaSetupResponse,
  QpdCalculationCreate,
  QpdCalculationOut,
  TokenPair,
  UserOut,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ACCESS_KEY = "twelvec_access_token";
const REFRESH_KEY = "twelvec_refresh_token";

export function getStoredTokens() {
  if (typeof window === "undefined") return { access: null, refresh: null };
  return {
    access: window.localStorage.getItem(ACCESS_KEY),
    refresh: window.localStorage.getItem(REFRESH_KEY),
  };
}

export function storeTokens(tokens: TokenPair) {
  window.localStorage.setItem(ACCESS_KEY, tokens.access_token);
  window.localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

async function raw<T>(
  path: string,
  init: RequestInit = {},
  { auth = true, retry = true }: { auth?: boolean; retry?: boolean } = {}
): Promise<T> {
  const { access } = getStoredTokens();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth && access) {
    headers["Authorization"] = `Bearer ${access}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && auth && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return raw<T>(path, init, { auth, retry: false });
    }
    clearTokens();
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let detail: unknown = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const { refresh } = getStoredTokens();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const tokens = (await res.json()) as TokenPair;
    storeTokens(tokens);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  async register(email: string, password: string): Promise<UserOut> {
    return raw<UserOut>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ email, password }) },
      { auth: false }
    );
  },

  async login(email: string, password: string): Promise<TokenPair | MfaRequiredResponse> {
    return raw<TokenPair | MfaRequiredResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      { auth: false }
    );
  },

  async mfaLogin(mfa_pending_token: string, totp_code: string): Promise<TokenPair> {
    return raw<TokenPair>(
      "/auth/mfa/login",
      { method: "POST", body: JSON.stringify({ mfa_pending_token, totp_code }) },
      { auth: false }
    );
  },

  async verifyEmail(token: string): Promise<UserOut> {
    return raw<UserOut>(
      "/auth/verify-email",
      { method: "POST", body: JSON.stringify({ token }) },
      { auth: false }
    );
  },

  async resendVerification(email: string): Promise<{ message: string }> {
    return raw<{ message: string }>(
      "/auth/resend-verification",
      { method: "POST", body: JSON.stringify({ email }) },
      { auth: false }
    );
  },

  async googleLogin(id_token: string): Promise<TokenPair | MfaRequiredResponse> {
    return raw<TokenPair | MfaRequiredResponse>(
      "/auth/google",
      { method: "POST", body: JSON.stringify({ id_token }) },
      { auth: false }
    );
  },

  async me(): Promise<UserOut> {
    return raw<UserOut>("/auth/me");
  },

  async logout(refresh_token: string): Promise<void> {
    await raw<void>(
      "/auth/logout",
      { method: "POST", body: JSON.stringify({ refresh_token }) },
      { auth: false, retry: false }
    );
  },

  async mfaSetup(): Promise<MfaSetupResponse> {
    return raw<MfaSetupResponse>("/auth/mfa/setup", { method: "POST" });
  },

  async mfaVerify(totp_code: string): Promise<UserOut> {
    return raw<UserOut>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ totp_code }),
    });
  },

  async mfaDisable(totp_code: string): Promise<UserOut> {
    return raw<UserOut>("/auth/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ totp_code }),
    });
  },

  async listBusinesses(): Promise<Business[]> {
    return raw<Business[]>("/businesses");
  },

  async createBusiness(payload: {
    name: string;
    default_exchange_rate: number;
    default_tax_rate: number;
    default_aids_levy_rate: number;
  }): Promise<Business> {
    return raw<Business>("/businesses", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getBusiness(id: string): Promise<Business> {
    return raw<Business>(`/businesses/${id}`);
  },

  async deleteBusiness(id: string): Promise<void> {
    await raw<void>(`/businesses/${id}`, { method: "DELETE" });
  },

  async listCalculations(businessId: string): Promise<QpdCalculationOut[]> {
    return raw<QpdCalculationOut[]>(`/businesses/${businessId}/qpd-calculations`);
  },

  async createCalculation(
    businessId: string,
    payload: QpdCalculationCreate
  ): Promise<QpdCalculationOut> {
    return raw<QpdCalculationOut>(`/businesses/${businessId}/qpd-calculations`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async applyPayments(
    businessId: string,
    calculationId: string,
    payload: ApplyPaymentsRequest
  ): Promise<QpdCalculationOut> {
    return raw<QpdCalculationOut>(
      `/businesses/${businessId}/qpd-calculations/${calculationId}/payments`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async deleteCalculation(businessId: string, calculationId: string): Promise<void> {
    await raw<void>(`/businesses/${businessId}/qpd-calculations/${calculationId}`, {
      method: "DELETE",
    });
  },
};
