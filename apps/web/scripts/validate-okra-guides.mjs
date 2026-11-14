// Validates every okra guide in src/site/okra-guides/content (drafts too).
// Runs at the start of `npm run build`; fails the build on errors.
//
// Published guides must have a page-specific hero photo and a 1200x630 social
// card, a human review, valid dates, descriptive alt text, and links that
// resolve. Drafts get the same checks as warnings so they can be finished
// incrementally. Rules live in validateOkraGuides() in ./okra-guides.mjs.

import { guidesContentDir, readGuideFiles, validateOkraGuides } from './okra-guides.mjs';
import { seoRoutes } from './seo-data.mjs';

// App routes that aren't prerendered but are valid link targets.
const APP_ONLY_PATHS = ['/okra/submissions', '/login', '/profile'];

async function main() {
  const entries = readGuideFiles();
  const knownPaths = [...seoRoutes.map((route) => route.path), ...APP_ONLY_PATHS];
  const { errors, warnings } = await validateOkraGuides(entries, { knownPaths });

  for (const warning of warnings) {
    console.warn(`validate-okra-guides: warning: ${warning}`);
  }

  if (errors.length > 0) {
    console.error(`validate-okra-guides: ${errors.length} error(s) in ${guidesContentDir()}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  const published = entries.filter(({ guide }) => guide.status === 'published').length;
  console.log(`validate-okra-guides: ${entries.length} guide(s) checked (${published} published, ${entries.length - published} draft).`);
}

main().catch((error) => {
  console.error('validate-okra-guides failed:', error);
  process.exit(1);
});
