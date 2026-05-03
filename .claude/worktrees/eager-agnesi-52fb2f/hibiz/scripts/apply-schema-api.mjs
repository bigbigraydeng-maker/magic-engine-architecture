/**
 * Apply SQL to a remote Supabase project via the Management API (beta).
 *
 * Prereqs:
 * 1. Create a Personal Access Token: https://supabase.com/dashboard/account/tokens
 *    If your org uses fine-grained tokens, include permission to run database queries (database_write).
 * 2. Project ref: Dashboard → Project Settings → General → "Reference ID".
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN="sbp_..."
 *   $env:SUPABASE_PROJECT_REF="abcdxyz..."
 *   node scripts/apply-schema-api.mjs
 *
 * Or pass a file:
 *   node scripts/apply-schema-api.mjs path/to/other.sql
 *
 * Docs: https://supabase.com/docs/reference/api/v1-run-a-query
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API = "https://api.supabase.com";
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref = process.env.SUPABASE_PROJECT_REF?.trim();

const sqlPath = process.argv[2] ?? join(__dirname, "..", "supabase", "migrations", "20260403120000_init_hibiz.sql");

async function main() {
  if (!token || !ref) {
    console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF.");
    process.exit(1);
  }

  let query;
  try {
    query = readFileSync(sqlPath, "utf8");
  } catch (e) {
    console.error("Cannot read SQL file:", sqlPath, e);
    process.exit(1);
  }

  const url = `${API}/v1/projects/${encodeURIComponent(ref)}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      read_only: false,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    console.error(text);
    process.exit(1);
  }

  console.log("OK — migration applied (or API returned success).");
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
