import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');

const jsFiles = readdirSync(DIST_ASSETS)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, size: statSync(join(DIST_ASSETS, name)).size }));

if (jsFiles.length === 0) {
  console.error('No JS bundles found in dist/assets. Run build first.');
  process.exit(1);
}

const mainBundle = jsFiles.find((file) => file.name.startsWith('index-'));
const vendorBundle = jsFiles.find((file) => file.name.includes('vendor'));

const MAX_MAIN_BYTES = 220 * 1024;
const MAX_VENDOR_BYTES = 520 * 1024;
const MAX_TOTAL_BYTES = 900 * 1024;

const totalBytes = jsFiles.reduce((sum, file) => sum + file.size, 0);

function assertWithinBudget(label, value, max) {
  if (value > max) {
    console.error(`${label} exceeded budget: ${value} bytes > ${max} bytes`);
    process.exitCode = 1;
  }
}

if (mainBundle) {
  assertWithinBudget('Main bundle', mainBundle.size, MAX_MAIN_BYTES);
}
if (vendorBundle) {
  assertWithinBudget('Vendor bundle', vendorBundle.size, MAX_VENDOR_BYTES);
}
assertWithinBudget('Total JS bundle size', totalBytes, MAX_TOTAL_BYTES);

console.log('Performance budget report');
for (const file of jsFiles) {
  console.log(`- ${file.name}: ${file.size} bytes`);
}
console.log(`Total: ${totalBytes} bytes`);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
