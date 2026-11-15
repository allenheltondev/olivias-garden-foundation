// Types for guide-core.mjs. Keep in sync with that file and with the guide
// JSON format documented in ./README.md.

export type GuideStatus = 'draft' | 'published';

export interface GuideImage {
  /** Path under apps/web/public, e.g. /images/okra/guides/<slug>/okra-pods.jpg */
  src: string;
  alt: string;
  caption?: string;
}

export type GuideBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'tip'; title?: string; text: string }
  | { type: 'table'; caption?: string; headers: string[]; rows: string[][] }
  | { type: 'image'; src: string; alt: string; caption?: string }
  | ZoneLookupBlock;

/** One row of a zoneLookup block: the planting advice for a range of hardiness zones. */
export interface ZoneLookupRow {
  /** Whole USDA zone numbers (1-13) this row covers. Every zone must be in exactly one row. */
  zones: number[];
  lastFrost: string;
  plant: string;
}

/** A ZIP code lookup that finds the reader's hardiness zone and highlights its row. */
export interface ZoneLookupBlock {
  type: 'zoneLookup';
  caption?: string;
  rows: ZoneLookupRow[];
}

export interface GuideSection {
  id: string;
  title: string;
  blocks: GuideBlock[];
  /** "aside" renders the section as a card in the right-hand rail (under the photo). Default "main". */
  placement?: 'main' | 'aside';
}

export interface GuideFaqItem {
  question: string;
  answer: string;
}

export interface GuideReview {
  reviewedBy: string;
  reviewedOn: string;
}

export interface OkraGuide {
  slug: string;
  status: GuideStatus;
  title: string;
  seoTitle?: string;
  description: string;
  summary: string;
  heroImage: GuideImage;
  socialImage: GuideImage;
  datePublished: string;
  dateModified?: string;
  review?: GuideReview;
  targetQueries?: string[];
  related?: string[];
  order?: number;
  /**
   * Where the seed request button goes. "callout" (default): a box under the
   * hero, good on long guides. "hero": a button under the summary, for pages
   * whose summary already is the pitch (e.g. free-okra-seeds).
   */
  seedCallToAction?: 'callout' | 'hero';
  /** Adds a link to this guide in the site footer, right after "Okra Project". */
  showInFooter?: boolean;
  intro: string[];
  sections: GuideSection[];
  faq?: GuideFaqItem[];
}

export type OkraGuideSummary = Pick<
  OkraGuide,
  'slug' | 'status' | 'title' | 'seoTitle' | 'description' | 'summary' | 'heroImage' | 'socialImage' | 'datePublished' | 'dateModified'
> & { order: number; seedCallToAction: 'callout' | 'hero' };

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; text: string; href: string };

export interface GuideRouteMeta {
  path: string;
  label: string;
  title: string;
  description: string;
  seoImage?: string;
  seoImageAlt?: string;
  ogType: 'article';
  allowIndex: boolean;
  prerender: true;
  showInFooter: boolean;
}

export interface JsonLdBlock {
  id: string;
  data: Record<string, unknown>;
}

export const OKRA_HUB_PATH: string;
export const OKRA_HUB_TITLE: string;
export const GUIDE_PATH_PREFIX: string;
export const ORGANIZATION_NAME: string;
export const TITLE_SUFFIX: string;
export const RESERVED_GUIDE_SLUGS: string[];

export function guidePath(slug: string): string;
export function parseInline(text: string): InlineToken[];
export function stripInline(text: string): string;
export function isInternalHref(href: string): boolean;
export function collectGuideTexts(guide: OkraGuide): string[];
export function collectGuideLinks(guide: OkraGuide): string[];
export function guidePageTitle(guide: Pick<OkraGuide, 'title' | 'seoTitle'>): string;
export function guideRouteMeta(guide: (OkraGuideSummary & { showInFooter?: boolean }) | OkraGuide): GuideRouteMeta;
export function guideSummary(guide: OkraGuide): OkraGuideSummary;
export function sortGuides<T extends { order?: number; title: string }>(guides: T[]): T[];
export function buildGuideArticleJsonLd(guide: OkraGuide, siteUrl: string): Record<string, unknown>;
export function buildGuideBreadcrumbJsonLd(guide: OkraGuide, siteUrl: string): Record<string, unknown>;
export function buildGuideFaqJsonLd(guide: OkraGuide): Record<string, unknown> | null;
export function buildGuideJsonLdBlocks(guide: OkraGuide, siteUrl: string): JsonLdBlock[];
export function escapeHtml(value: string): string;
export function inlineToHtml(text: string): string;
export function renderGuideFallbackHtml(guide: OkraGuide, relatedGuides?: Array<Pick<OkraGuide, 'slug' | 'title'>>): string;
export function renderGuideListHtml(guides: Array<Pick<OkraGuide, 'slug' | 'title' | 'description'>>): string;
export function formatGuideDate(isoDate: string | undefined): string;
export const ZONE_LOOKUP_HEADERS: string[];
export function zoneRowLabel(zones: number[]): string;
