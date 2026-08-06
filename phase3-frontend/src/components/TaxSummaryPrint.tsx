"use client";

import { money, percent } from "@/lib/format";
import { Business, QpdCalculationOut } from "@/lib/types";

const DUE_DATES = ["25 March", "25 June", "25 September", "20 December"];

/**
 * Renders a clean, single-page tax summary that is invisible on screen
 * (display: none) and only appears via the print stylesheet. The
 * "Download PDF" button just calls window.print() - the browser's own
 * "Save as PDF" destination produces the file, so there's no extra
 * dependency and no server round trip.
 */
export function TaxSummaryPrint({
  business,
  calculation,
}: {
  business: Business;
  calculation: QpdCalculationOut;
}) {
  const r = calculation.result_json;
  const input = calculation.input_json;
  const generatedOn = new Date().toLocaleDateString("en-ZW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const exchangeRate = input.exchange_rate ?? business.default_exchange_rate;
  const taxRate = input.tax_rate ?? business.default_tax_rate;
  const aidsLevyRate = input.aids_levy_rate ?? business.default_aids_levy_rate;

  return (
    <div className="hidden print:block print:p-0">
      <div className="mb-6 flex items-center justify-between border-b-2 border-black pb-4">
        <div>
          <div className="font-display text-2xl font-bold">
            Twelve<span>C</span>
          </div>
          <div className="text-xs text-gray-600">QPD Provisional Tax Summary</div>
        </div>
        <div className="text-right text-xs text-gray-600">
          <div>Generated {generatedOn}</div>
          <div>Not a ZIMRA filing document — for internal/accountant use</div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Business</div>
          <div className="font-semibold">{business.name}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Tax year / period</div>
          <div className="font-semibold">
            {calculation.tax_year} — {calculation.quarter_label}
          </div>
        </div>
      </div>

      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-t border-black">
            <th className="py-1 text-left font-semibold">Rates applied</th>
            <th className="py-1 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-300">
            <td className="py-1">Exchange rate (ZiG per USD)</td>
            <td className="py-1 text-right">{exchangeRate}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-1">Corporate tax rate</td>
            <td className="py-1 text-right">{percent(taxRate)}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-1">AIDS levy (on tax payable)</td>
            <td className="py-1 text-right">{percent(aidsLevyRate)}</td>
          </tr>
        </tbody>
      </table>

      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-t border-black">
            <th className="py-1 text-left font-semibold">Adjusted computation</th>
            <th className="py-1 text-right font-semibold">USD</th>
            <th className="py-1 text-right font-semibold">ZiG</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-300">
            <td className="py-1">Adjusted income</td>
            <td className="py-1 text-right">{money(r.adjusted_income_usd, "USD")}</td>
            <td className="py-1 text-right">{money(r.adjusted_income_zig, "ZIG")}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-1">Adjusted deductions</td>
            <td className="py-1 text-right">{money(r.adjusted_deductions_usd, "USD")}</td>
            <td className="py-1 text-right">{money(r.adjusted_deductions_zig, "ZIG")}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-1">Taxable profit</td>
            <td className="py-1 text-right">{money(r.taxable_profit_usd, "USD")}</td>
            <td className="py-1 text-right">{money(r.taxable_profit_zig, "ZIG")}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-1">Tax payable</td>
            <td className="py-1 text-right">{money(r.tax_payable_usd, "USD")}</td>
            <td className="py-1 text-right">{money(r.tax_payable_zig, "ZIG")}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-1">AIDS levy</td>
            <td className="py-1 text-right">{money(r.aids_levy_usd, "USD")}</td>
            <td className="py-1 text-right">{money(r.aids_levy_zig, "ZIG")}</td>
          </tr>
          <tr className="border-b border-black font-semibold">
            <td className="py-1">Total tax due</td>
            <td className="py-1 text-right">{money(r.total_tax_usd, "USD")}</td>
            <td className="py-1 text-right">{money(r.total_tax_zig, "ZIG")}</td>
          </tr>
        </tbody>
      </table>

      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-t border-black">
            <th className="py-1 text-left font-semibold">QPD schedule</th>
            <th className="py-1 text-left font-semibold">Due date</th>
            <th className="py-1 text-right font-semibold">%</th>
            <th className="py-1 text-right font-semibold">USD</th>
            <th className="py-1 text-right font-semibold">ZiG</th>
            <th className="py-1 text-right font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody>
          {r.schedule.map((inst, i) => (
            <tr key={i} className="border-b border-gray-300">
              <td className="py-1">Q{i + 1}</td>
              <td className="py-1">{DUE_DATES[i] ?? inst.label}</td>
              <td className="py-1 text-right">{Math.round(inst.percentage * 100)}%</td>
              <td className="py-1 text-right">{money(inst.usd, "USD")}</td>
              <td className="py-1 text-right">{money(inst.zig, "ZIG")}</td>
              <td className="py-1 text-right">
                {inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01
                  ? "Paid"
                  : `${money(inst.usd_balance, "USD")} / ${money(inst.zig_balance, "ZIG")}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 border-t border-gray-300 pt-3 text-[10px] leading-relaxed text-gray-500">
        Twelve C is an independent calculator and is not affiliated with the Zimbabwe Revenue
        Authority. This summary is generated from figures entered by the business owner and is
        provided for planning and record-keeping purposes. Verify all figures against ZIMRA's
        TaRMS portal, or with a registered tax practitioner, before filing or making payment.
      </p>
    </div>
  );
}
