#!/usr/bin/env node
/**
 * Builds the ZIP code to USDA plant hardiness zone lookup used by the
 * "When to plant okra" guide.
 *
 * Source: the 2023 USDA Plant Hardiness Zone Map ZIP code tables published by
 * the PRISM Group at Oregon State University (https://prism.oregonstate.edu/phzm/).
 * Their terms allow the data to be freely reproduced and distributed, as long
 * as the page using it names PRISM, links to it and gives the access date (see
 * HARDINESS_ZONE_SOURCE in src/site/okra-guides/hardiness-zones.ts).
 *
 * Output: public/data/hardiness-zones/2023/<first two digits>.json, each a
 * { "75070": "8b", ... } map. Splitting by the first two digits keeps every
 * lookup to one small file (a few KB) instead of the whole country. The
 * folder is versioned because the deploy caches /data files as immutable: a
 * new map edition goes in a new folder.
 *
 * Usage:
 *   node scripts/build-hardiness-zones.mjs               # download from PRISM
 *   node scripts/build-hardiness-zones.mjs --from=<dir>  # use CSVs already downloaded
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDITION = '2023';
const REGIONS = ['us', 'ak', 'hi', 'pr'];
const sourceUrl = (region) => `https://prism.oregonstate.edu/phzm/data/${EDITION}/phzm_${region}_zipcode_${EDITION}.csv`;

const ZIP_PATTERN = /^\d{5}$/;
const ZONE_PATTERN = /^(1[0-3]|[1-9])[ab]$/;

/** Parses one PRISM CSV (zipcode,zone,trange,zonetitle) into [zip, zone] pairs. */
export function parseZoneCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.split(',').map((cell) => cell.trim().toLowerCase()) ?? [];
  const zipIndex = header.indexOf('zipcode');
  const zoneIndex = header.indexOf('zone');
  if (zipIndex === -1 || zoneIndex === -1) {
    throw new Error(`Unexpected PRISM CSV header: ${header.join(',')}`);
  }
  return lines.map((line, index) => {
    const cells = line.split(',');
    const zip = cells[zipIndex]?.trim();
    const zone = cells[zoneIndex]?.trim();
    if (!ZIP_PATTERN.test(zip ?? '') || !ZONE_PATTERN.test(zone ?? '')) {
      throw new Error(`Bad row ${index + 2}: ${line}`);
    }
    return [zip, zone];
  });
}

/** Groups [zip, zone] pairs into shards keyed by the ZIP's first two digits. */
export function shardZones(pairs) {
  const shards = new Map();
  for (const [zip, zone] of [...pairs].sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = zip.slice(0, 2);
    if (!shards.has(prefix)) shards.set(prefix, {});
    shards.get(prefix)[zip] = zone;
  }
  return shards;
}

async function readSource(region, fromDir) {
  if (fromDir) {
    return readFileSync(join(fromDir, `phzm_${region}_zipcode_${EDITION}.csv`), 'utf8');
  }
  const response = await fetch(sourceUrl(region));
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${sourceUrl(region)}`);
  }
  return response.text();
}

async function main() {
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
  const fromDir = fromArg ? fromArg.slice('--from='.length) : undefined;
  const pairs = [];
  for (const region of REGIONS) {
    pairs.push(...parseZoneCsv(await readSource(region, fromDir)));
  }

  const outDir = fileURLToPath(new URL(`../public/data/hardiness-zones/${EDITION}/`, import.meta.url));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const shards = shardZones(pairs);
  for (const [prefix, zones] of shards) {
    writeFileSync(join(outDir, `${prefix}.json`), `${JSON.stringify(zones)}\n`);
  }
  console.log(`build-hardiness-zones: wrote ${pairs.length} ZIP codes in ${shards.size} files to ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
