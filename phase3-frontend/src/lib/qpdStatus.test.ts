import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatedQuarterObligations,
  getConfirmedPaidAmounts,
  splitObligations,
} from "./qpdStatus";
import type { QpdCalculationOut } from "./types";

function makeCalc(overrides: Partial<QpdCalculationOut> = {}): QpdCalculationOut {
  return {
    id: "calc-1",
    business_id: "biz-1",
    tax_year: 2026,
    quarter_label: "QPD1",
    quarter: 1,
    input_json: {
      usd_sales: 100000,
      zig_sales: 0,
      usd_expenses: { cost_of_sales: 0, salaries: 0, other_expenses: 0, capital_allowances: 0 },
      zig_expenses: { cost_of_sales: 0, salaries: 0, other_expenses: 0, capital_allowances: 0 },
      exchange_rate: 26.8,
      tax_rate: 0.25,
      aids_levy_rate: 0.03,
      quarter: 1,
      previous_qpds_paid_usd: 0,
      previous_qpds_paid_zig: 0,
      assessed_loss_usd: 0,
      assessed_loss_zig: 0,
      withholding_credits_usd: 0,
      withholding_credits_zig: 0,
    },
    result_json: {
      usd_ratio: 1,
      zig_ratio: 0,
      payment_ratio_usd: 0.5,
      payment_ratio_zig: 0.5,
      adjusted_income_usd: 50000,
      adjusted_income_zig: 1340000,
      adjusted_deductions_usd: 0,
      adjusted_deductions_zig: 0,
      taxable_profit_usd: 50000,
      taxable_profit_zig: 1340000,
      tax_payable_usd: 12500,
      tax_payable_zig: 335000,
      aids_levy_usd: 375,
      aids_levy_zig: 10050,
      total_tax_usd: 12875,
      total_tax_zig: 345050,
      schedule: [],
      quarter: 1,
      due_date: "25 March",
      cumulative_percentage: 0.1,
      cumulative_due_usd: 1287.5,
      cumulative_due_zig: 34505,
      previous_paid_usd: 0,
      previous_paid_zig: 0,
      net_payable_usd: 1287.5,
      net_payable_zig: 34505,
    },
    actual_usd_paid: null,
    actual_zig_paid: null,
    payment_confirmed_at: null,
    created_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

test("newly calculated QPD defaults to unpaid (0 paid) and shows full net payable balance", () => {
  const calc = makeCalc();
  const [obligation] = evaluatedQuarterObligations([calc], 2026);

  assert.equal(obligation.confirmed, false);
  assert.equal(obligation.paid, false);
  assert.equal(obligation.partial, false);
  assert.equal(obligation.usdPaid, 0);
  assert.equal(obligation.zigPaid, 0);
  assert.equal(obligation.usdBalance, 1287.5);
  assert.equal(obligation.zigBalance, 34505);

  const { overdue } = splitObligations([obligation], new Date(2026, 3, 1));
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].usdBalance, 1287.5);
});

test("legacy unconfirmed row with seeded actual_*_paid is still treated as unpaid", () => {
  const legacySeeded = makeCalc({
    actual_usd_paid: 1287.5,
    actual_zig_paid: 34505,
    payment_confirmed_at: null,
  });

  const paidAmounts = getConfirmedPaidAmounts(legacySeeded);
  assert.deepEqual(paidAmounts, { usd: 0, zig: 0, confirmed: false });

  const [obligation] = evaluatedQuarterObligations([legacySeeded], 2026);
  assert.equal(obligation.paid, false);
  assert.equal(obligation.usdBalance, 1287.5);
});

test("partial confirmed payment reduces remaining balance without marking paid in full", () => {
  const partialCalc = makeCalc({
    actual_usd_paid: 500,
    actual_zig_paid: 10000,
    payment_confirmed_at: "2026-03-25T12:00:00Z",
  });

  const [obligation] = evaluatedQuarterObligations([partialCalc], 2026);
  assert.equal(obligation.confirmed, true);
  assert.equal(obligation.partial, true);
  assert.equal(obligation.paid, false);
  assert.equal(obligation.usdPaid, 500);
  assert.equal(obligation.zigPaid, 10000);
  assert.equal(obligation.usdBalance, 787.5);
  assert.equal(obligation.zigBalance, 24505);
});

test("full confirmed payment marks quarter paid in full with zero balance", () => {
  const fullCalc = makeCalc({
    actual_usd_paid: 1287.5,
    actual_zig_paid: 34505,
    payment_confirmed_at: "2026-03-25T12:00:00Z",
  });

  const [obligation] = evaluatedQuarterObligations([fullCalc], 2026);
  assert.equal(obligation.confirmed, true);
  assert.equal(obligation.partial, false);
  assert.equal(obligation.paid, true);
  assert.equal(obligation.usdBalance, 0);
  assert.equal(obligation.zigBalance, 0);

  const { overdue, upcoming } = splitObligations([obligation], new Date(2026, 3, 1));
  assert.equal(overdue.length, 0);
  assert.equal(upcoming.length, 0);
});
