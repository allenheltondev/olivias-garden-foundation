// Adds published okra guides to dist/llms.txt (copied from public/llms.txt by
// Vite). Guides are listed under "## Okra Growing Guides", right after
// "## Key Pages", so LLM crawlers can find and cite them. Drafts are never
// listed. Idempotent: reruns replace the generated section.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guidePath } from '../src/site/okra-guides/guide-core.mjs';
import { okraGuides, siteUrl } from './seo-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const llmsPath = join(__dirname, '..', 'dist', 'llms.txt');
const SECTION_HEADING = '## Okra Growing Guides';

export function withGuideSection(text, guides) {
  // Split into "## " sections (the first part is the preamble), drop any
  // previously generated guide section, and re-insert after Key Pages.
  const parts = text.split(/\n(?=## )/).filter((part) => !part.startsWith(SECTION_HEADING));

  if (guides.length > 0) {
    const section = [
      SECTION_HEADING,
      '',
      ...guides.map((guide) => `- ${siteUrl}${guidePath(guide.slug)} : ${guide.title}. ${guide.description}`),
      '',
    ].join('\n');
    const keyPagesIndex = parts.findIndex((part) => part.startsWith('## Key Pages'));
    parts.splice(keyPagesIndex === -1 ? parts.length : keyPagesIndex + 1, 0, section);
  }

  return parts.join('\n');
}

async function main() {
  const published = okraGuides.filter((guide) => guide.status === 'published');
  const text = await readFile(llmsPath, 'utf8');
  await writeFile(llmsPath, withGuideSection(text, published), 'utf8');
  console.log(`generate-llms: listed ${published.length} okra guide(s) in ${llmsPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('generate-llms failed:', error);
    process.exit(1);
  });
}
