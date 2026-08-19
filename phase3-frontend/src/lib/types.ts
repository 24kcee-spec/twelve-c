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