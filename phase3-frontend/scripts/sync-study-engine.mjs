import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(frontendRoot, "..");
const sourceRoot = resolve(repoRoot, "phase2-backend", "engine", "zimra_qpd");
const targetRoot = resolve(frontendRoot, "public", "study-engine", "zimra_qpd");
const files = ["calculator.py", "tax_rules.py"];

await mkdir(targetRoot, { recursive: true });

const hashes = {};
for (const file of files) {
  const source = await readFile(resolve(sourceRoot, file), "utf8");
  await writeFile(resolve(targetRoot, file), source, "utf8");
  hashes[file] = createHash("sha256").update(source, "utf8").digest("hex");
}

// Do not copy the package's normal __init__.py: it imports additional engine
// modules that are intentionally not needed in the browser-only study runtime.
await writeFile(
  resolve(targetRoot, "__init__.py"),
  "# Intentionally empty study package. See the frozen engine source files.\n",
  "utf8"
);

const manifest = {
  engine: "phase2-backend/engine/zimra_qpd",
  calculatorSha256: hashes["calculator.py"],
  taxRulesSha256: hashes["tax_rules.py"],
  buildCommit:
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.NEXT_PUBLIC_BUILD_COMMIT ||
    "local-build",
  pyodideVersion: "v314.0.8",
};

const manifestPath = resolve(frontendRoot, "public", "study-engine", "manifest.json");
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Twelve C study engine synced from the backend's authoritative Python source.");
console.log(`calculator.py SHA-256: ${manifest.calculatorSha256}`);
console.log(`tax_rules.py SHA-256: ${manifest.taxRulesSha256}`);
console.log(`Build commit: ${manifest.buildCommit}`);
