import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { parse } from 'csv-parse';

export async function* readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = (await fsp.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean);
  for (const line of lines) yield JSON.parse(line);
}

export async function appendJsonl(filePath, records) {
  await fsp.mkdir(new URL('.', `file://${filePath}`), { recursive: true }).catch(() => {});
  if (!records?.length) {
    // Keep queue/report files present even when there are zero rows.
    if (!fs.existsSync(filePath)) await fsp.writeFile(filePath, '', 'utf8');
    return;
  }
  const payload = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await fsp.appendFile(filePath, payload, 'utf8');
}

export async function computeChecksum(filePath) {
  const data = await fsp.readFile(filePath);
  return `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
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
