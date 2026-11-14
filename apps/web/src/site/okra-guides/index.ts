// Typed access to okra growing guides for the React app.
//
// Metadata comes from the `virtual:okra-guides` module (see
// scripts/vite-plugin-okra-guides.mjs); full guide content is loaded lazily,
// one chunk per guide. Authoring docs: ./README.md.

import { okraGuideLoaders, okraGuideRoutes as guideRoutes, okraGuideSummaries } from 'virtual:okra-guides';
import type { AppRoute } from '../routes';
import type { GuideRouteMeta, OkraGuide, OkraGuideSummary } from './guide-core.mjs';

export type { GuideBlock, GuideImage, OkraGuide, OkraGuideSummary } from './guide-core.mjs';

export const okraGuides = okraGuideSummaries as OkraGuideSummary[];

// Built in Node by guideRouteMeta() so guide-core stays out of the main bundle.
export const okraGuideRoutes: AppRoute[] = guideRoutes as GuideRouteMeta[];

export function findOkraGuide(slug: string | undefined): OkraGuideSummary | undefined {
  return slug ? okraGuides.find((guide) => guide.slug === slug) : undefined;
}

export async function loadOkraGuide(slug: string): Promise<OkraGuide> {
  const loader = okraGuideLoaders[slug];
  if (!loader) {
    throw new Error(`Unknown okra guide: ${slug}`);
  }
  const module = await loader();
  return module.default as OkraGuide;
}
