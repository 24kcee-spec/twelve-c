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
  usd_sales: number;
  zig_sales: number;
  usd_expenses: CurrencyExpensesIn;
  zig_expenses: CurrencyExpensesIn;
  exchange_rate?: number | null;
  tax_rate?: number | null;
  aids_levy_rate?: number | null;
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
}

export interface QpdCalculationOut {
  id: string;
  business_id: string;
  tax_year: number;
  quarter_label: string;
  input_json: QpdCalculationCreate;
  result_json: QpdResultJson;
  created_at: string;
}

export interface ApplyPaymentsRequest {
  usd_paid: number[];
  zig_paid: number[];
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