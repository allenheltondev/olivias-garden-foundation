import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  buildGuideArticleJsonLd,
  buildGuideBreadcrumbJsonLd,
  buildGuideFaqJsonLd,
  buildGuideJsonLdBlocks,
  collectGuideLinks,
  formatGuideDate,
  guideRouteMeta,
  guideSummary,
  parseInline,
  renderGuideFallbackHtml,
  renderGuideListHtml,
  stripInline,
} from '../src/site/okra-guides/guide-core.mjs';
import { layoutHeadline, renderSocialCard } from './generate-guide-social-card.mjs';
import { withGuideSection } from './generate-llms.mjs';
import { loadOkraGuides, readGuideFiles, validateOkraGuides } from './okra-guides.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '__fixtures__', 'okra-guides');
const siteUrl = 'https://oliviasgarden.org';
const knownPaths = ['/', '/okra', '/faq', '/about'];

const readFixture = (slug) => JSON.parse(readFileSync(join(fixtureDir, `${slug}.json`), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

let publicRoot;
let workDir;

async function writeImage(root, src, width, height) {
  const out = join(root, src.replace(/^\//, ''));
  mkdirSync(dirname(out), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#336431' } }).jpeg().toFile(out);
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'okra-guides-test-'));
  publicRoot = join(workDir, 'public');
  await writeImage(publicRoot, '/images/okra/olivia-okra.jpg', 978, 1304);
  await writeImage(publicRoot, '/images/social/okra-guides/example-okra-guide.jpg', 1200, 630);
  await writeImage(publicRoot, '/images/social/okra-guides/example-related-guide.jpg', 1200, 630);
  await writeImage(publicRoot, '/images/social/okra-guides/wrong-size.jpg', 1000, 1000);
  await writeImage(publicRoot, '/images/home/og-image.png', 1200, 630);
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function entriesFor(...guides) {
  return guides.map((guide) => ({ file: `/content/${guide.slug}.json`, guide }));
}

async function validate(...guides) {
  return validateOkraGuides(entriesFor(...guides), { root: publicRoot, knownPaths, sharp });
}

describe('inline markup', () => {
  test('parses links and bold and leaves other text literal', () => {
    assert.deepEqual(parseInline('Plant [after frost](/okra/when) in **full sun**, not *here*.'), [
      { type: 'text', text: 'Plant ' },
      { type: 'link', text: 'after frost', href: '/okra/when' },
      { type: 'text', text: ' in ' },
      { type: 'strong', text: 'full sun' },
      { type: 'text', text: ', not *here*.' },
    ]);
    assert.equal(stripInline('See [the map](/okra) **now**'), 'See the map now');
  });

  test('collects every link in a guide', () => {
    const links = collectGuideLinks(readFixture('example-okra-guide'));
    assert.ok(links.includes('/okra'));
    assert.ok(links.includes('/faq#growing-okra'));
    assert.ok(links.includes('https://example.org/okra'));
    assert.ok(links.includes('/okra/example-related-guide'));
  });
});

describe('loading guides', () => {
  test('sorts by order and excludes drafts unless asked', () => {
    const dir = join(workDir, 'content-drafts');
    mkdirSync(dir, { recursive: true });
    for (const slug of ['example-okra-guide', 'example-related-guide']) {
      copyFileSync(join(fixtureDir, `${slug}.json`), join(dir, `${slug}.json`));
    }
    const draft = { ...readFixture('example-related-guide'), slug: 'draft-guide', status: 'draft', order: 1 };
    writeFileSync(join(dir, 'draft-guide.json'), JSON.stringify(draft));

    assert.deepEqual(loadOkraGuides({ dir, includeDrafts: false }).map((guide) => guide.slug), ['example-okra-guide', 'example-related-guide']);
    assert.deepEqual(loadOkraGuides({ dir, includeDrafts: true }).map((guide) => guide.slug), ['draft-guide', 'example-okra-guide', 'example-related-guide']);
  });

  test('reports malformed JSON with the filename', () => {
    const dir = join(workDir, 'content-bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    assert.throws(() => readGuideFiles(dir), /broken\.json is not valid JSON/);
  });
});

describe('validation', () => {
  test('fixture guides pass', async () => {
    const { errors } = await validate(readFixture('example-okra-guide'), readFixture('example-related-guide'));
    assert.deepEqual(errors, []);
  });

  test('a published guide must have its own social card', async () => {
    const guide = readFixture('example-okra-guide');
    delete guide.socialImage;
    const { errors } = await validate(guide, readFixture('example-related-guide'));
    assert.ok(errors.some((error) => /socialImage\.src is required/.test(error)), errors.join('\n'));
  });

  test('the site-wide default card is rejected', async () => {
    const guide = readFixture('example-okra-guide');
    guide.socialImage.src = '/images/home/og-image.png';
    const { errors } = await validate(guide, readFixture('example-related-guide'));
    assert.ok(errors.some((error) => /specific to this guide/.test(error)), errors.join('\n'));
  });

  test('two guides cannot share a social card', async () => {
    const related = readFixture('example-related-guide');
    related.socialImage.src = '/images/social/okra-guides/example-okra-guide.jpg';
    const { errors } = await validate(readFixture('example-okra-guide'), related);
    assert.ok(errors.some((error) => /already used by/.test(error)), errors.join('\n'));
  });

  test('social cards must be exactly 1200x630 and exist', async () => {
    const wrongSize = readFixture('example-okra-guide');
    wrongSize.socialImage.src = '/images/social/okra-guides/wrong-size.jpg';
    const missing = readFixture('example-related-guide');
    missing.socialImage.src = '/images/social/okra-guides/missing.jpg';
    const { errors } = await validate(wrongSize, missing);
    assert.ok(errors.some((error) => /1000x1000; it must be exactly 1200x630/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /missing\.jpg does not exist/.test(error)), errors.join('\n'));
  });

  test('hero images need descriptive filenames and alt text', async () => {
    const guide = readFixture('example-okra-guide');
    guide.heroImage = { src: '/images/okra/IMG_1234.jpg', alt: 'okra' };
    const { errors } = await validate(guide, readFixture('example-related-guide'));
    assert.ok(errors.some((error) => /IMG_1234\.jpg" should describe the image/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /alt text is too short/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /heroImage \/images\/okra\/IMG_1234\.jpg does not exist/.test(error)), errors.join('\n'));
  });

  test('a published guide requires a human review', async () => {
    const guide = readFixture('example-okra-guide');
    delete guide.review;
    const { errors } = await validate(guide, readFixture('example-related-guide'));
    assert.ok(errors.some((error) => /a person must review/.test(error)), errors.join('\n'));
  });

  test('drafts get publishing problems as warnings, not errors', async () => {
    const draft = { ...readFixture('example-related-guide'), status: 'draft' };
    delete draft.socialImage;
    delete draft.review;
    const published = readFixture('example-okra-guide');
    published.related = [];
    published.sections[1].blocks[0].text = 'Tip without links.';
    const { errors, warnings } = await validate(published, draft);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((warning) => /socialImage\.src is required/.test(warning)));
    assert.ok(warnings.some((warning) => /a person must review/.test(warning)));
  });

  test('published guides cannot link to drafts', async () => {
    const draft = { ...readFixture('example-related-guide'), status: 'draft' };
    const { errors } = await validate(readFixture('example-okra-guide'), draft);
    assert.ok(errors.some((error) => /related guide "example-related-guide" is still a draft/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /points at a draft guide/.test(error)), errors.join('\n'));
  });

  test('unknown internal links and bad hrefs are caught', async () => {
    const guide = readFixture('example-okra-guide');
    guide.intro.push('See [this](/okra/not-a-guide) and [that](javascript:alert).');
    const { errors } = await validate(guide, readFixture('example-related-guide'));
    assert.ok(errors.some((error) => /\/okra\/not-a-guide does not match a known page/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /javascript:alert must be an internal path/.test(error)), errors.join('\n'));
  });

  test('links nested inside bold text are rejected, even in drafts', async () => {
    const guide = { ...readFixture('example-related-guide'), status: 'draft' };
    guide.intro = ['**See the [map](/okra)** for more.'];
    const { errors } = await validate(readFixture('example-okra-guide'), guide);
    assert.ok(errors.some((error) => /link inside bold text won't render/.test(error)), errors.join('\n'));
  });

  test('seedCallToAction only accepts "callout" or "hero"', async () => {
    const guide = readFixture('example-related-guide');
    guide.seedCallToAction = 'sidebar';
    const { errors } = await validate(readFixture('example-okra-guide'), guide);
    assert.ok(errors.some((error) => /seedCallToAction must be/.test(error)), errors.join('\n'));
    guide.seedCallToAction = 'hero';
    assert.deepEqual((await validate(readFixture('example-okra-guide'), guide)).errors, []);
  });

  test('structural problems are errors even for drafts', async () => {
    const guide = { ...readFixture('example-related-guide'), status: 'draft', slug: 'submissions' };
    guide.sections = [{ id: 'Bad Id', title: '', blocks: [{ type: 'video' }] }];
    guide.faq = [{ question: 'Not a question', answer: '' }];
    const { errors } = await validateOkraGuides(
      [{ file: '/content/other-name.json', guide }],
      { root: publicRoot, knownPaths, sharp },
    );
    for (const pattern of [/filename must match slug/, /collides with an existing/, /id must be kebab-case/, /title is required/, /type must be one of/, /must be a question/, /answer is required/]) {
      assert.ok(errors.some((error) => pattern.test(error)), `expected ${pattern}\n${errors.join('\n')}`);
    }
  });
});

describe('structured data and fallback HTML', () => {
  const guide = readFixture('example-okra-guide');

  test('Article JSON-LD carries dates, images, and the organization', () => {
    const article = buildGuideArticleJsonLd(guide, siteUrl);
    assert.equal(article['@type'], 'Article');
    assert.equal(article.headline, guide.seoTitle);
    assert.equal(article.url, `${siteUrl}/okra/example-okra-guide`);
    assert.equal(article.datePublished, '2026-11-14');
    assert.equal(article.dateModified, '2026-11-15');
    assert.deepEqual(article.image, [
      `${siteUrl}/images/okra/olivia-okra.jpg`,
      `${siteUrl}/images/social/okra-guides/example-okra-guide.jpg`,
    ]);
    assert.equal(article.publisher['@id'], `${siteUrl}/#organization`);
  });

  test('breadcrumbs go Home > The Okra Project > guide', () => {
    const crumbs = buildGuideBreadcrumbJsonLd(guide, siteUrl);
    assert.deepEqual(crumbs.itemListElement.map((item) => item.name), ['Home', 'The Okra Project', 'Example okra guide']);
    assert.equal(crumbs.itemListElement[2].item, `${siteUrl}/okra/example-okra-guide`);
  });

  test('FAQ JSON-LD strips inline markup, and is omitted without an FAQ', () => {
    const faq = buildGuideFaqJsonLd(guide);
    assert.equal(faq.mainEntity[0].acceptedAnswer.text, 'No. It is a test fixture; see the Okra Project.');
    const withoutFaq = { ...guide, faq: [] };
    assert.equal(buildGuideFaqJsonLd(withoutFaq), null);
    assert.deepEqual(buildGuideJsonLdBlocks(withoutFaq, siteUrl).map((block) => block.id), ['okra-guide-article', 'okra-guide-breadcrumbs']);
  });

  test('fallback HTML contains the whole guide, escaped', () => {
    const html = renderGuideFallbackHtml({ ...guide, summary: 'Use <b>care</b> & patience.' }, [readFixture('example-related-guide')]);
    assert.match(html, /<h1>Example okra guide<\/h1>/);
    assert.match(html, /Use &lt;b&gt;care&lt;\/b&gt; &amp; patience\./);
    assert.match(html, /<a href="\/okra">internal link<\/a>/);
    assert.match(html, /<h2 id="tips-and-tables">Tips and tables<\/h2>/);
    assert.match(html, /<th scope="col">Region<\/th>/);
    assert.match(html, /<ol><li>Step one<\/li><li>Step two<\/li><\/ol>/);
    assert.match(html, /<h3>Is this a real guide\?<\/h3>/);
    assert.match(html, /Request seeds and see the Okra Project map/);
    assert.match(html, /<a href="\/okra\/example-related-guide">Example related guide<\/a>/);
    assert.match(html, /Reviewed by Fixture Reviewer on 2026-11-15/);
  });

  test('route metadata marks drafts noindex and uses the page-specific card', () => {
    assert.deepEqual(guideRouteMeta(guide), {
      path: '/okra/example-okra-guide',
      label: 'Example okra guide',
      title: guide.seoTitle,
      description: guide.description,
      seoImage: '/images/social/okra-guides/example-okra-guide.jpg',
      seoImageAlt: guide.socialImage.alt,
      ogType: 'article',
      allowIndex: true,
      prerender: true,
    });
    assert.equal(guideRouteMeta({ ...guide, status: 'draft' }).allowIndex, false);
  });

  test('the slim summary carries the seed button placement, defaulting to the callout', () => {
    assert.equal(guideSummary(guide).seedCallToAction, 'callout');
    assert.equal(guideSummary({ ...guide, seedCallToAction: 'hero' }).seedCallToAction, 'hero');
  });

  test('hub list and dates render', () => {
    assert.equal(renderGuideListHtml([]), '');
    assert.match(renderGuideListHtml([guide]), /<a href="\/okra\/example-okra-guide">Example okra guide<\/a>/);
    assert.equal(formatGuideDate('2026-11-05'), 'November 5, 2026');
  });
});

describe('llms.txt section', () => {
  const base = '# Site\n\n## Key Pages\n\n- https://oliviasgarden.org/okra : Okra\n\n## Stable Facts\n\n- Fact\n';

  test('lists guides after Key Pages and is idempotent', () => {
    const guides = [readFixture('example-okra-guide')];
    const once = withGuideSection(base, guides);
    assert.match(once, /## Key Pages[\s\S]*## Okra Growing Guides\n\n- https:\/\/oliviasgarden\.org\/okra\/example-okra-guide : Example okra guide\./);
    assert.ok(once.indexOf('## Okra Growing Guides') < once.indexOf('## Stable Facts'));
    assert.equal(withGuideSection(once, guides), once);
    assert.equal(withGuideSection(once, []).includes('Okra Growing Guides'), false);
  });
});

describe('social card generator', () => {
  test('fits long headlines in four lines or fewer', () => {
    const { lines, fontSize } = layoutHeadline('When to plant okra in North Texas and across the South');
    assert.ok(lines.length <= 4);
    assert.ok(fontSize >= 44 && fontSize <= 64);
  });

  test('renders a 1200x630 card from a photo', async () => {
    const outPath = join(workDir, 'cards', 'card.jpg');
    await renderSocialCard({
      photoPath: join(publicRoot, 'images/okra/olivia-okra.jpg'),
      headline: 'How to grow okra',
      outPath,
    });
    const { width, height, format } = await sharp(outPath).metadata();
    assert.deepEqual({ width, height, format }, { width: 1200, height: 630, format: 'jpeg' });
  });
});

test('fixtures stay independent from each other', () => {
  const guide = clone(readFixture('example-okra-guide'));
  guide.title = 'changed';
  assert.equal(readFixture('example-okra-guide').title, 'Example okra guide');
});
