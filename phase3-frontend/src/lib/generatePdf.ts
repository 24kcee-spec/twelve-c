import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Business, QpdCalculationOut } from "@/lib/types";
import { money, percent } from "@/lib/format";

const DUE_DATES = ["25 March", "25 June", "25 September", "20 December"];
const IS_USD = "USD" as const;
const IS_ZIG = "ZIG" as const;

/** Turns "Kuda's Bakery / Q3!" into "Kudas-Bakery-Q3" - safe for a filename
 *  on both Windows and macOS/Linux. */
function safeFileSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Builds and triggers a real browser download of a Twelve C tax summary PDF.
 * Unlike window.print(), this never opens the OS print dialog - jsPDF draws
 * the document as vector text directly, then doc.save() hands the browser a
 * Blob and a filename, which downloads immediately to the user's Downloads
 * folder like any other file.
 */
export function downloadTaxSummaryPdf(business: Business, calculation: QpdCalculationOut) {
  const r = calculation.result_json;
  const input = calculation.input_json;
  const exchangeRate = input.exchange_rate ?? business.default_exchange_rate;
  const taxRate = input.tax_rate ?? business.default_tax_rate;
  const aidsLevyRate = input.aids_levy_rate ?? business.default_aids_levy_rate;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 50;

  // --- Header ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Twelve C", marginX, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  doc.text("QPD Provisional Tax Summary", marginX, y + 16);

  const generatedOn = new Date().toLocaleDateString("en-ZW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.setFontSize(9);
  doc.text(`Generated ${generatedOn}`, pageWidth - marginX, y - 4, { align: "right" });
  doc.text("Not a ZIMRA filing document - for internal/accountant use", pageWidth - marginX, y + 10, {
    align: "right",
  });

  doc.setDrawColor(0);
  doc.setLineWidth(1.2);
  y += 26;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 26;

  // --- Business / period ---
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("BUSINESS", marginX, y);
  doc.text("TAX YEAR / PERIOD", pageWidth / 2, y);
  doc.setTextColor(0);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(business.name, marginX, y + 16);
  doc.text(`${calculation.tax_year} - ${calculation.quarter_label}`, pageWidth / 2, y + 16);
  doc.setFont("helvetica", "normal");
  y += 40;

  // --- Rates applied ---
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [["Rates applied", "Value"]],
    body: [
      ["Exchange rate (ZiG per USD)", String(exchangeRate)],
      ["Corporate tax rate", percent(taxRate)],
      ["AIDS levy (on tax payable)", percent(aidsLevyRate)],
    ],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fontStyle: "bold", lineWidth: { bottom: 1 }, lineColor: 0 },
    columnStyles: { 1: { halign: "right" } },
    didDrawPage: (data) => {
      y = data.cursor?.y ?? y;
    },
  });
  // @ts-expect-error - jspdf-autotable attaches this at runtime
  y = doc.lastAutoTable.finalY + 24;

  // --- Adjusted computation ---
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [["Adjusted computation", "USD", "ZiG"]],
    body: [
      ["Adjusted income", money(r.adjusted_income_usd, IS_USD), money(r.adjusted_income_zig, IS_ZIG)],
      ["Adjusted deductions", money(r.adjusted_deductions_usd, IS_USD), money(r.adjusted_deductions_zig, IS_ZIG)],
      ["Taxable profit", money(r.taxable_profit_usd, IS_USD), money(r.taxable_profit_zig, IS_ZIG)],
      ["Tax payable", money(r.tax_payable_usd, IS_USD), money(r.tax_payable_zig, IS_ZIG)],
      ["AIDS levy", money(r.aids_levy_usd, IS_USD), money(r.aids_levy_zig, IS_ZIG)],
    ],
    foot: [["Total tax due", money(r.total_tax_usd, IS_USD), money(r.total_tax_zig, IS_ZIG)]],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fontStyle: "bold", lineWidth: { bottom: 1 }, lineColor: 0 },
    footStyles: { fontStyle: "bold", textColor: 0, lineWidth: { top: 1 }, lineColor: 0, fillColor: false },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
  });
  // @ts-expect-error - jspdf-autotable attaches this at runtime
  y = doc.lastAutoTable.finalY + 24;

  // --- QPD schedule ---
  const scheduleRows = r.schedule.map((inst, i) => {
    const usdBalance = inst.usd_balance ?? inst.usd - (inst.usd_paid ?? 0);
    const zigBalance = inst.zig_balance ?? inst.zig - (inst.zig_paid ?? 0);
    const paid = usdBalance <= 0.01 && zigBalance <= 0.01;
    return [
      `Q${i + 1}`,
      DUE_DATES[i] ?? inst.label,
      `${Math.round(inst.percentage * 100)}%`,
      money(inst.usd, IS_USD),
      money(inst.zig, IS_ZIG),
      paid ? "Paid" : `${money(usdBalance, IS_USD)} / ${money(zigBalance, IS_ZIG)}`,
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [["QPD schedule", "Due date", "%", "USD", "ZiG", "Balance"]],
    body: scheduleRows,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fontStyle: "bold", lineWidth: { bottom: 1 }, lineColor: 0 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });
  // @ts-expect-error - jspdf-autotable attaches this at runtime
  y = doc.lastAutoTable.finalY + 30;

  // --- Disclaimer ---
  doc.setFontSize(8);
  doc.setTextColor(120);
  const disclaimer =
    "Twelve C is an independent calculator and is not affiliated with the Zimbabwe Revenue Authority. " +
    "This summary is generated from figures entered by the business owner and is provided for planning " +
    "and record-keeping purposes. Verify all figures against ZIMRA's TaRMS portal, or with a registered " +
    "tax practitioner, before filing or making payment.";
  const wrapped = doc.splitTextToSize(disclaimer, pageWidth - marginX * 2);
  doc.text(wrapped, marginX, y);

  const filename = `Twelve-C-${safeFileSegment(business.name)}-${calculation.tax_year}-${safeFileSegment(
    calculation.quarter_label
  )}.pdf`;
  doc.save(filename);
}