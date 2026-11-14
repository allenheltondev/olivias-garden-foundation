// Vite plugin exposing okra guides to the app.
//
//   import { okraGuideSummaries, okraGuideRoutes, okraGuideLoaders } from 'virtual:okra-guides';
//
// - okraGuideSummaries: slim metadata (slug, title, description, images) for
//   guide lists and the guide page hero.
// - okraGuideRoutes: precomputed route-table entries (guideRouteMeta), so the
//   main bundle carries plain data instead of guide-core code.
// - okraGuideLoaders: slug -> () => import(...) of the full guide. Each guide
//   is its own lazy chunk, so adding guides doesn't grow the main bundle.
//
// Content comes from the same loader the build scripts use
// (scripts/okra-guides.mjs), so the app, prerender, and sitemap always agree
// on which guides exist. Drafts are included on the dev server and when
// VITE_INCLUDE_DRAFT_GUIDES=true.

import { guideRouteMeta, guideSummary } from '../src/site/okra-guides/guide-core.mjs';
import { guidesContentDir, loadOkraGuides, shouldIncludeDrafts } from './okra-guides.mjs';

const REGISTRY_ID = 'virtual:okra-guides';
const CONTENT_PREFIX = 'virtual:okra-guide-content/';

export function okraGuidesPlugin() {
  let includeDrafts = shouldIncludeDrafts();
  const contentDir = guidesContentDir();

  const currentGuides = () => loadOkraGuides({ dir: contentDir, includeDrafts });

  return {
    name: 'okra-guides',

    configResolved(config) {
      if (config.command === 'serve') {
        includeDrafts = true;
      }
    },

    resolveId(id) {
      if (id === REGISTRY_ID || id.startsWith(CONTENT_PREFIX)) {
        return `\0${id}`;
      }
      return null;
    },

    load(id) {
      if (id === `\0${REGISTRY_ID}`) {
        this.addWatchFile(contentDir);
        const guides = currentGuides();
        const loaders = guides
          .map((guide) => `  ${JSON.stringify(guide.slug)}: () => import(${JSON.stringify(`${CONTENT_PREFIX}${guide.slug}`)}),`)
          .join('\n');
        return [
          `export const okraGuideSummaries = ${JSON.stringify(guides.map(guideSummary))};`,
          `export const okraGuideRoutes = ${JSON.stringify(guides.map(guideRouteMeta))};`,
          `export const okraGuideLoaders = {\n${loaders}\n};`,
        ].join('\n');
      }

      if (id.startsWith(`\0${CONTENT_PREFIX}`)) {
        const slug = id.slice(`\0${CONTENT_PREFIX}`.length);
        const guide = currentGuides().find((candidate) => candidate.slug === slug);
        if (!guide) {
          throw new Error(`Unknown okra guide: ${slug}`);
        }
        return `export default ${JSON.stringify(guide)};`;
      }

      return null;
    },

    configureServer(server) {
      server.watcher.add(contentDir);
      const reload = (file) => {
        if (!file.startsWith(contentDir)) {
          return;
        }
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (module.id?.startsWith(`\0${REGISTRY_ID}`) || module.id?.startsWith(`\0${CONTENT_PREFIX}`)) {
            server.moduleGraph.invalidateModule(module);
          }
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('change', reload);
      server.watcher.on('unlink', reload);
    },
  };
}
