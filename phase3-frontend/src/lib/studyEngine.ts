"use client";

import type { QpdResultJson } from "@/lib/types";

const PYODIDE_VERSION = "v314.0.8";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

export interface StudyEngineInput {
  tax_year: number;
  quarter: number;
  usd_sales: number;
  zig_sales: number;
  usd_expenses: {
    cost_of_sales: number;
    salaries: number;
    other_expenses: number;
    capital_allowances: number;
  };
  zig_expenses: {
    cost_of_sales: number;
    salaries: number;
    other_expenses: number;
    capital_allowances: number;
  };
  exchange_rate: number;
  tax_rate: number;
  aids_levy_rate: number;
  previous_qpds_paid_usd: number;
  previous_qpds_paid_zig: number;
  assessed_loss_usd: number;
  assessed_loss_zig: number;
  withholding_credits_usd: number;
  withholding_credits_zig: number;
}

export interface StudyEngineManifest {
  engine: string;
  calculatorSha256: string;
  taxRulesSha256: string;
  buildCommit: string;
  pyodideVersion: string;
}

interface PyProxyString {
  toString(): string;
  destroy?: () => void;
}

interface PyodideRuntime {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string): void;
  };
  runPythonAsync(code: string): Promise<unknown>;
  globals: {
    set(name: string, value: unknown): void;
    delete(name: string): void;
  };
}

declare global {
  interface Window {
    loadPyodide?: (options: { indexURL: string }) => Promise<PyodideRuntime>;
  }
}

let runtimePromise: Promise<PyodideRuntime> | null = null;
let scriptPromise: Promise<void> | null = null;

function loadPyodideScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The study calculator must run in a browser."));
  }
  if (window.loadPyodide) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-twelve-c-pyodide="true"]'
    );
    const script = existing ?? document.createElement("script");
    script.src = `${PYODIDE_INDEX}pyodide.js`;
    script.async = true;
    script.dataset.twelveCPyodide = "true";
    script.onload = () => {
      if (window.loadPyodide) resolve();
      else reject(new Error("The browser Python runtime loaded without its initialiser."));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the browser calculation runtime. Check your internet connection and try again."));
    };
    if (!existing) document.head.appendChild(script);
  });

  return scriptPromise;
}

async function fetchEngineSource(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`The frozen calculation engine could not be loaded (${response.status}). Rebuild and redeploy the study site.`);
  }
  return response.text();
}

async function getRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await loadPyodideScript();
      if (!window.loadPyodide) throw new Error("The browser calculation runtime is unavailable.");

      const [calculatorSource, rulesSource] = await Promise.all([
        fetchEngineSource("/study-engine/zimra_qpd/calculator.py"),
        fetchEngineSource("/study-engine/zimra_qpd/tax_rules.py"),
      ]);

      const pyodide = await window.loadPyodide({ indexURL: PYODIDE_INDEX });
      pyodide.FS.mkdirTree("/home/pyodide/study_engine/zimra_qpd");
      pyodide.FS.writeFile(
        "/home/pyodide/study_engine/zimra_qpd/__init__.py",
        "# Intentionally empty: import only the two frozen engine modules used by the study.\n"
      );
      pyodide.FS.writeFile(
        "/home/pyodide/study_engine/zimra_qpd/calculator.py",
        calculatorSource
      );
      pyodide.FS.writeFile(
        "/home/pyodide/study_engine/zimra_qpd/tax_rules.py",
        rulesSource
      );

      await pyodide.runPythonAsync(
        "import sys\\nsys.path.insert(0, '/home/pyodide/study_engine')\\nfrom zimra_qpd.calculator import CurrencyExpenses, QpdInput, calculate_qpd"
      );
      return pyodide;
    })().catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export async function calculateStudyQpd(input: StudyEngineInput): Promise<QpdResultJson> {
  const pyodide = await getRuntime();
  pyodide.globals.set("study_input_json", JSON.stringify(input));

  let returned: unknown;
  try {
    returned = await pyodide.runPythonAsync(String.raw`
import dataclasses
import json
from zimra_qpd.calculator import CurrencyExpenses, QpdInput, calculate_qpd

payload = json.loads(study_input_json)
data = QpdInput(
    usd_sales=payload["usd_sales"],
    zig_sales=payload["zig_sales"],
    tax_year=payload["tax_year"],
    usd_expenses=CurrencyExpenses(**payload["usd_expenses"]),
    zig_expenses=CurrencyExpenses(**payload["zig_expenses"]),
    exchange_rate=payload["exchange_rate"],
    tax_rate=payload["tax_rate"],
    aids_levy_rate=payload["aids_levy_rate"],
    quarter=payload["quarter"],
    previous_qpds_paid_usd=payload["previous_qpds_paid_usd"],
    previous_qpds_paid_zig=payload["previous_qpds_paid_zig"],
    assessed_loss_usd=payload["assessed_loss_usd"],
    assessed_loss_zig=payload["assessed_loss_zig"],
    withholding_credits_usd=payload["withholding_credits_usd"],
    withholding_credits_zig=payload["withholding_credits_zig"],
)
result = calculate_qpd(data)
output = dataclasses.asdict(result)
output["schedule"] = [
    {
        **dataclasses.asdict(item),
        "usd_balance": item.usd_balance,
        "zig_balance": item.zig_balance,
    }
    for item in result.schedule
]
json.dumps(output, separators=(",", ":"))
`);
  } finally {
    pyodide.globals.delete("study_input_json");
  }

  const jsonText =
    typeof returned === "string"
      ? returned
      : returned && typeof returned === "object" && "toString" in returned
        ? (returned as PyProxyString).toString()
        : "";
  if (!jsonText) throw new Error("The calculation engine returned an empty result.");
  const parsed = JSON.parse(jsonText) as QpdResultJson;
  if (
    !Number.isFinite(parsed.net_payable_usd) ||
    !Number.isFinite(parsed.net_payable_zig) ||
    !Array.isArray(parsed.schedule) ||
    parsed.schedule.length !== 4
  ) {
    throw new Error("The calculation engine returned an incomplete result.");
  }
  return parsed;
}

export async function readStudyEngineManifest(): Promise<StudyEngineManifest> {
  const response = await fetch("/study-engine/manifest.json", {
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error("The study engine build manifest is unavailable.");
  return (await response.json()) as StudyEngineManifest;
}
