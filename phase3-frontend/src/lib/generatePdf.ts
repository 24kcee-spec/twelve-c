import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Business, QpdCalculationOut } from "@/lib/types";
import { money, percent } from "@/lib/format";

const DUE_DATES = ["25 March", "25 June", "25 September", "20 December"];
const IS_USD = "USD" as const;
const IS_ZIG = "ZIG" as const;

// --- Ledger palette (matches zimra_qpd.pdf_export / xlsx_export - the
// backend's full-year Working Papers export - so the per-quarter PDF a
// person downloads mid-year and the full-year one they download later
// read as the same product, not two different tools). Keep these in sync
// by hand if the backend palette ever changes; there's no shared source
// between a Python reportlab doc and this jsPDF one.
const INK: [number, number, number] = [31, 26, 23]; // #1F1A17
const INK_SOFT: [number, number, number] = [107, 98, 90]; // #6B625A
const SEAL: [number, number, number] = [156, 107, 46]; // #9C6B2E - ochre gold
const LINE: [number, number, number] = [216, 207, 192]; // #D8CFC0
const PAPER: [number, number, number] = [251, 247, 240]; // #FBF7F0
const HEADER_BAND: [number, number, number] = [43, 35, 29]; // #2B231D
const GOLD_FILL: [number, number, number] = [243, 230, 204]; // #F3E6CC - headline figures
const BAND_SUBTEXT: [number, number, number] = [216, 207, 192]; // #D8CFC0

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
  const bandHeight = 78;
  let y: number;

  // --- Header band (dark ink band, matches the backend export's header) ---
  doc.setFillColor(...HEADER_BAND);
  doc.rect(0, 0, pageWidth, bandHeight, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("Twelve C", marginX, 34);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BAND_SUBTEXT);
  doc.text("QPD Provisional Tax Summary", marginX, 50);

  const generatedOn = new Date().toLocaleDateString("en-ZW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(business.name, pageWidth - marginX, 34, { align: "right" });
  doc.setTextColor(...BAND_SUBTEXT);
  doc.text(`Generated ${generatedOn}`, pageWidth - marginX, 46, { align: "right" });
  doc.text("Not a ZIMRA filing document \u2014 internal/accountant use", pageWidth - marginX, 58, {
    align: "right",
  });

  y = bandHeight + 34;

  // --- Business / period ---
  doc.setFontSize(9);
  doc.setTextColor(...INK_SOFT);
  doc.setFont("helvetica", "normal");
  doc.text("BUSINESS", marginX, y);
  doc.text("TAX YEAR / PERIOD", pageWidth / 2, y);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  doc.text(business.name, marginX, y + 16);
  doc.text(`${calculation.tax_year} - ${calculation.quarter_label}`, pageWidth / 2, y + 16);
  doc.setFont("helvetica", "normal");
  y += 40;

  const sectionHeadStyles = {
    fontStyle: "bold" as const,
    fillColor: HEADER_BAND,
    textColor: [255, 255, 255] as [number, number, number],
    lineWidth: 0,
  };
  const bodyStyles = { fontSize: 10, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.4 };
  const alternateRowStyles = { fillColor: PAPER };

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
    styles: bodyStyles,
    headStyles: sectionHeadStyles,
    alternateRowStyles,
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
    styles: bodyStyles,
    headStyles: sectionHeadStyles,
    alternateRowStyles,
    footStyles: { fontStyle: "bold", textColor: INK, lineWidth: { top: 0.6 }, lineColor: SEAL, fillColor: GOLD_FILL },
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
    styles: bodyStyles,
    headStyles: sectionHeadStyles,
    alternateRowStyles,
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
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.line(marginX, y - 14, pageWidth - marginX, y - 14);
  doc.setFontSize(8);
  doc.setTextColor(...INK_SOFT);
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
