// Converts a Duffel export (JSON) into SQL inserts for `wrangler d1 execute --file`.
// Usage: npx tsx scripts/export-to-sql.ts <input.json> <output.sql>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { exportToSql, isDuffelExport } from '../src/shared/exportFormat';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: tsx scripts/export-to-sql.ts <input.json> <output.sql>');
  process.exit(1);
}
const data: unknown = JSON.parse(readFileSync(input, 'utf8'));
if (!isDuffelExport(data)) {
  console.error(`${input} is not a Duffel export.`);
  process.exit(1);
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, exportToSql(data));
console.log(`Wrote ${output}`);
