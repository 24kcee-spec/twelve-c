import { Business, QpdCalculationOut } from "@/lib/types";

const DUE_DATES = ["25 March", "25 June", "25 September", "20 December"];

function fmtMoney(value: number, currency: "USD" | "ZIG"): string {
  const n = Number.isFinite(value) ? value : 0;
  const formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${formatted}` : `ZiG ${formatted}`;
}

function fmtPercent(value: number, digits = 0): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${(n * 100).toFixed(digits)}%`;
}

function buildHtml(business: Business, calculation: QpdCalculationOut): string {
  const r = calculation.result_json;
  const input = (calculation.input_json || {}) as any;
  const generatedOn = new Date().toLocaleDateString("en-ZW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const exchangeRate = input.exchange_rate ?? business.default_exchange_rate;
  const taxRate = input.tax_rate ?? business.default_tax_rate;
  const aidsLevyRate = input.aids_levy_rate ?? business.default_aids_levy_rate;

  const scheduleRows = r.schedule
    .map((inst: any, i: number) => {
      const usdBalance = inst.usd_balance ?? (inst.usd - (inst.usd_paid ?? 0));
      const zigBalance = inst.zig_balance ?? (inst.zig - (inst.zig_paid ?? 0));
      const paid = usdBalance <= 0.01 && zigBalance <= 0.01;
      return `
        <tr>
          <td>Q${i + 1}</td>
          <td>${DUE_DATES[i] ?? inst.label}</td>
          <td class="right">${Math.round(inst.percentage * 100)}%</td>
          <td class="right">${fmtMoney(inst.usd, "USD")}</td>
          <td class="right">${fmtMoney(inst.zig, "ZIG")}</td>
          <td class="right">${paid ? "Paid" : `${fmtMoney(usdBalance, "USD")} / ${fmtMoney(zigBalance, "ZIG")}`}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Twelve C - Tax Summary - ${business.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #1a1a1a; margin: 32px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 16px; margin-bottom: 24px; }
  .logo { font-size: 22px; font-weight: 700; }
  .logo span { color: #2563eb; }
  .meta { text-align: right; font-size: 11px; color: #555; line-height: 1.5; }
  .sub { font-size: 11px; color: #555; margin-top: 2px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #777; }
  .value { font-weight: 600; font-size: 14px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
  th { text-align: left; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 4px; font-weight: 600; }
  td { padding: 6px 4px; border-bottom: 1px solid #ddd; }
  .right { text-align: right; }
  tfoot td { font-weight: 700; border-top: 1px solid #000; border-bottom: none; }
  .disclaimer { font-size: 9px; color: #777; border-top: 1px solid #ddd; padding-top: 10px; margin-top: 24px; line-height: 1.5; }
  @page { size: A4; margin: 16mm; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Twelve<span>C</span></div>
      <div class="sub">QPD Provisional Tax Summary</div>
    </div>
    <div class="meta">
      <div>Generated ${generatedOn}</div>
      <div>Not a ZIMRA filing document - for internal/accountant use</div>
    </div>
  </div>

  <div class="grid2">
    <div>
      <div class="label">Business</div>
      <div class="value">${business.name}</div>
    </div>
    <div>
      <div class="label">Tax year / period</div>
      <div class="value">${calculation.tax_year} - ${calculation.quarter_label}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Rates applied</th><th class="right">Value</th></tr></thead>
    <tbody>
      <tr><td>Exchange rate (ZiG per USD)</td><td class="right">${exchangeRate}</td></tr>
      <tr><td>Corporate tax rate</td><td class="right">${fmtPercent(taxRate)}</td></tr>
      <tr><td>AIDS levy (on tax payable)</td><td class="right">${fmtPercent(aidsLevyRate)}</td></tr>
    </tbody>
  </table>

  <table>
    <thead><tr><th>Adjusted computation</th><th class="right">USD</th><th class="right">ZiG</th></tr></thead>
    <tbody>
      <tr><td>Adjusted income</td><td class="right">${fmtMoney(r.adjusted_income_usd, "USD")}</td><td class="right">${fmtMoney(r.adjusted_income_zig, "ZIG")}</td></tr>
      <tr><td>Adjusted deductions</td><td class="right">${fmtMoney(r.adjusted_deductions_usd, "USD")}</td><td class="right">${fmtMoney(r.adjusted_deductions_zig, "ZIG")}</td></tr>
      <tr><td>Taxable profit</td><td class="right">${fmtMoney(r.taxable_profit_usd, "USD")}</td><td class="right">${fmtMoney(r.taxable_profit_zig, "ZIG")}</td></tr>
      <tr><td>Tax payable</td><td class="right">${fmtMoney(r.tax_payable_usd, "USD")}</td><td class="right">${fmtMoney(r.tax_payable_zig, "ZIG")}</td></tr>
      <tr><td>AIDS levy</td><td class="right">${fmtMoney(r.aids_levy_usd, "USD")}</td><td class="right">${fmtMoney(r.aids_levy_zig, "ZIG")}</td></tr>
    </tbody>
    <tfoot>
      <tr><td>Total tax due</td><td class="right">${fmtMoney(r.total_tax_usd, "USD")}</td><td class="right">${fmtMoney(r.total_tax_zig, "ZIG")}</td></tr>
    </tfoot>
  </table>

  <table>
    <thead>
      <tr><th>QPD schedule</th><th>Due date</th><th class="right">%</th><th class="right">USD</th><th class="right">ZiG</th><th class="right">Balance</th></tr>
    </thead>
    <tbody>
      ${scheduleRows}
    </tbody>
  </table>

  <p class="disclaimer">
    Twelve C is an independent calculator and is not affiliated with the Zimbabwe Revenue
    Authority. This summary is generated from figures entered by the business owner and is
    provided for planning and record-keeping purposes. Verify all figures against ZIMRA's
    TaRMS portal, or with a registered tax practitioner, before filing or making payment.
  </p>
</body>
</html>`;
}

export function printTaxSummary(business: Business, calculation: QpdCalculationOut) {
  const printWindow = window.open("", "_blank", "width=850,height=1100");
  if (!printWindow) {
    alert("Your browser blocked the print popup. Please allow popups for this site and try again.");
    return;
  }

  const html = buildHtml(business, calculation);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  let printed = false;
  const triggerPrint = () => {
    if (printed || printWindow.closed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
  };

  printWindow.onload = triggerPrint;
  // Fallback in case onload does not fire reliably after document.write().
  setTimeout(triggerPrint, 400);
}
