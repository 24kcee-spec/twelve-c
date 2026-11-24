"use client";

import type { Business } from "@/lib/types";
import type { StudyCalculation } from "@/lib/studyStorage";

type Cell = string | number | null;

const MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function worksheetXml(rows: Cell[][]): string {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          if (value === null || value === undefined || value === "") return "";
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
            String(value)
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
    `<sheetData>${rowXml}</sheetData></worksheet>`
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zipStore(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true); // store: no compression
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 33, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 33, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);

    localOffset += local.length + data.length;
  }

  const centralDirectory = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, centralDirectory, end], { type: MIME });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadStudyWorkbook(
  business: Business,
  calculations: StudyCalculation[],
  selected: StudyCalculation
): void {
  const input = selected.input_json;
  const result = selected.result_json;
  const confirmed = selected.payment_confirmed_at !== null;
  const qpdRows: Cell[][] = [
    ["Quarter", "Payment due date", "Instalment", "Cumulative target", "USD due", "ZiG due", "USD paid (confirmed)", "ZiG paid (confirmed)", "Payment confirmed"],
  ];

  for (const item of [...calculations]
    .filter((entry) => entry.tax_year === selected.tax_year)
    .sort((a, b) => a.quarter - b.quarter)) {
    qpdRows.push([
      `Q${item.quarter}`,
      item.result_json.due_date,
      item.result_json.schedule[item.quarter - 1]?.percentage ?? 0,
      item.result_json.cumulative_percentage,
      item.result_json.net_payable_usd,
      item.result_json.net_payable_zig,
      item.payment_confirmed_at ? item.actual_usd_paid ?? 0 : null,
      item.payment_confirmed_at ? item.actual_zig_paid ?? 0 : null,
      item.payment_confirmed_at ? "Yes" : "No",
    ]);
  }

  const summaryRows: Cell[][] = [
    ["Twelve C — Study Mode Working Paper"],
    ["Fictional business", business.name],
    ["Tax year", selected.tax_year],
    ["Calculation", selected.quarter_label],
    ["Created", selected.created_at],
    ["Study build", "Browser-only study mode"],
    [],
    ["Calculation result", "USD", "ZiG"],
    ["Adjusted income", result.adjusted_income_usd, result.adjusted_income_zig],
    ["Adjusted deductions", result.adjusted_deductions_usd, result.adjusted_deductions_zig],
    ["Taxable profit", result.taxable_profit_usd, result.taxable_profit_zig],
    ["Tax payable", result.tax_payable_usd, result.tax_payable_zig],
    ["AIDS levy", result.aids_levy_usd, result.aids_levy_zig],
    ["Total tax", result.total_tax_usd, result.total_tax_zig],
    ["Cumulative target", result.cumulative_percentage, result.cumulative_percentage],
    ["Previous confirmed payments", result.previous_paid_usd, result.previous_paid_zig],
    ["Net payable this quarter", result.net_payable_usd, result.net_payable_zig],
    ["Actual payment confirmed", confirmed ? "Yes" : "No", confirmed ? "Yes" : "No"],
  ];

  const inputRows: Cell[][] = [
    ["Twelve C — Study Inputs"],
    ["Business", business.name],
    ["Tax year", selected.tax_year],
    ["Quarter", selected.quarter],
    ["Exchange rate (ZiG per USD)", input.exchange_rate],
    ["Corporate tax rate", input.tax_rate],
    ["AIDS levy rate", input.aids_levy_rate],
    [],
    ["Input", "USD", "ZiG"],
    ["Sales", input.usd_sales, input.zig_sales],
    ["Cost of sales", input.usd_expenses.cost_of_sales, input.zig_expenses.cost_of_sales],
    ["Salaries", input.usd_expenses.salaries, input.zig_expenses.salaries],
    ["Other expenses", input.usd_expenses.other_expenses, input.zig_expenses.other_expenses],
    ["Capital allowances", input.usd_expenses.capital_allowances, input.zig_expenses.capital_allowances],
    ["Assessed loss brought forward", input.assessed_loss_usd, input.assessed_loss_zig],
    ["Withholding credits", input.withholding_credits_usd, input.withholding_credits_zig],
    ["Previous QPD payments", input.previous_qpds_paid_usd, input.previous_qpds_paid_zig],
  ];

  const workbook = zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Inputs" sheetId="2" r:id="rId2"/><sheet name="QPD Schedule" sheetId="3" r:id="rId3"/></sheets>' +
        "</workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' +
        "</Relationships>",
    },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(summaryRows) },
    { name: "xl/worksheets/sheet2.xml", content: worksheetXml(inputRows) },
    { name: "xl/worksheets/sheet3.xml", content: worksheetXml(qpdRows) },
  ]);

  const safeName =
    business.name.replace(/[\\/:*?"<>|]/g, "").trim().replace(/\s+/g, "-") || "Study-Business";
  downloadBlob(
    workbook,
    `Twelve-C-${safeName}-QPD-Working-Papers-${selected.tax_year}.xlsx`
  );
}
