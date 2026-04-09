import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { parse } from 'csv-parse';

export async function* readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) yield JSON.parse(trimmed);
  }
}

export async function appendJsonl(filePath, records) {
  await fsp.mkdir(new URL('.', `file://${filePath}`), { recursive: true }).catch(() => {});
  if (!records?.length) {
    // Keep queue/report files present even when there are zero rows.
    if (!fs.existsSync(filePath)) await fsp.writeFile(filePath, '', 'utf8');
    return;
  }
  // Write in chunks to avoid building a single huge string
  const CHUNK = 1000;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const payload = slice.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await fsp.appendFile(filePath, payload, 'utf8');
  }
}

export async function computeChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

export async function readQuotedCsv(filePath) {
  const content = await fsp.readFile(filePath, 'utf8');
  return new Promise((resolve, reject) => {
    parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true }, (err, out) => err ? reject(err) : resolve(out));
  });
}

export async function readHeaderlessCsv(filePath, columns) {
  const content = await fsp.readFile(filePath, 'utf8');
  return new Promise((resolve, reject) => {
    parse(content, { columns, skip_empty_lines: true, relax_quotes: true }, (err, out) => err ? reject(err) : resolve(out));
  });
}
