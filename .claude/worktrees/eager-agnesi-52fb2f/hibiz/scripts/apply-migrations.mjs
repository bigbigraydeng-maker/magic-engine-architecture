#!/usr/bin/env node
/**
 * Apply HiBiz Supabase migrations via REST API (using service_role JWT)
 * Usage: node scripts/apply-migrations.mjs <project_url> <service_role_key>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_URL = process.argv[2];
const SERVICE_ROLE_KEY = process.argv[3];

if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
  console.error('Usage: node scripts/apply-migrations.mjs <project_url> <service_role_key>');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

// List migration files in order
const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`🔄 Found ${migrationFiles.length} migrations to apply`);
console.log(`📍 Project: ${PROJECT_URL}\n`);

let successCount = 0;
let failCount = 0;

for (const file of migrationFiles) {
  const filePath = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(filePath, 'utf-8');

  console.log(`⏳ Applying: ${file}`);

  try {
    // Call Supabase RPC endpoint to execute SQL
    // Using a simple approach: call to a function if available, or via raw query
    // For now, we'll use a cURL-style approach via Node's fetch

    const response = await fetch(`${PROJECT_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed: ${file}`);
      console.error(`   Error: ${error}`);
      failCount++;
      continue;
    }

    console.log(`✅ Applied: ${file}`);
    successCount++;
  } catch (e) {
    console.error(`❌ Error applying ${file}: ${e.message}`);
    failCount++;
  }
}

console.log(`\n📊 Summary: ${successCount} succeeded, ${failCount} failed`);

if (failCount > 0) {
  process.exit(1);
}
