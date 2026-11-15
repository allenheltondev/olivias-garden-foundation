import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const appRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(appRoot, 'public', 'images');
const outputRoot = path.join(sourceRoot, 'responsive');
const defaultWidths = [480, 768, 1280, 1600, 1920];
const defaultFormats = ['avif'];
const supportedInputExtensions = new Set(['.jpg', '.jpeg', '.png']);
const generatedPathSegment = `${path.sep}responsive${path.sep}`;

async function loadSharp() {
  try {
    const module = await import('sharp');
    return module.default;
  } catch {
    throw new Error(
      'This script requires the "sharp" package. Install it in apps/web before running: npm install -D sharp --workspace @olivias/web',
    );
  }
}

function parseCsvArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }

  return raw
    .slice(name.length + 3)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseWidthArg() {
  const widths = parseCsvArg('widths', defaultWidths.map(String))
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  return [...new Set(widths)].sort((left, right) => left - right);
}

function parseFormatArg() {
  const formats = parseCsvArg('formats', defaultFormats)
    .map((value) => value.toLowerCase())
    .filter((value) => ['avif'].includes(value));

  return [...new Set(formats)];
}

async function collectImageFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'responsive') {
        continue;
      }

      files.push(...await collectImageFiles(absolutePath));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (supportedInputExtensions.has(extension)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function qualityFor(format) {
  return { quality: 55 };
}

async function generateVariant(sharp, sourcePath, outputPath, width, format) {
  const pipeline = sharp(sourcePath)
    .rotate()
    .resize({ width, withoutEnlargement: true });

  pipeline.avif(qualityFor(format));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await pipeline.toFile(outputPath);
}

async function readExistingManifest() {
  try {
    const existing = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
    return existing.images ?? {};
  } catch {
    throw new Error('--only needs an existing manifest.json. Run without --only first.');
  }
}

async function main() {
  const sharp = await loadSharp();
  const widths = parseWidthArg();
  const formats = parseFormatArg();
  // --only=okra/guides/foo,okra/guides/bar regenerates just those folders (or
  // files) and keeps every other image's variants and manifest entry as is.
  // Without it, everything is rebuilt from scratch.
  const only = parseCsvArg('only', []).map((prefix) => prefix.replace(/^\/+|\/+$/g, ''));
  const isSelected = (relativePath) => only.length === 0
    || only.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
  const manifest = only.length === 0 ? {} : await readExistingManifest();
  let generatedCount = 0;

  if (widths.length === 0) {
    throw new Error('No valid widths were provided.');
  }
  if (formats.length === 0) {
    throw new Error('No valid formats were provided.');
  }

  console.log(`Source root: ${sourceRoot}`);
  console.log(`Output root: ${outputRoot}`);
  console.log(`Widths: ${widths.join(', ')}`);
  console.log(`Formats: ${formats.join(', ')}`);

  if (only.length === 0) {
    await rm(outputRoot, { recursive: true, force: true });
  } else {
    console.log(`Only: ${only.join(', ')}`);
    for (const key of Object.keys(manifest)) {
      if (isSelected(key)) delete manifest[key];
    }
    for (const prefix of only) {
      const parsed = path.parse(prefix);
      // Remove old variants for the selected folders (or a single file's widths).
      await rm(path.join(outputRoot, prefix), { recursive: true, force: true });
      if (parsed.ext) {
        const dir = path.join(outputRoot, parsed.dir);
        const stale = (await readdir(dir).catch(() => [])).filter((name) => name.startsWith(`${parsed.name}-`));
        await Promise.all(stale.map((name) => rm(path.join(dir, name), { force: true })));
      }
    }
  }
  await mkdir(outputRoot, { recursive: true });

  const sourceFiles = await collectImageFiles(sourceRoot);
  console.log(`Found ${sourceFiles.length} source images.`);

  for (const sourcePath of sourceFiles) {
    if (sourcePath.includes(generatedPathSegment)) {
      continue;
    }

    const relativePath = path.relative(sourceRoot, sourcePath);
    if (!isSelected(relativePath.replaceAll(path.sep, '/'))) {
      continue;
    }
    const parsedPath = path.parse(relativePath);
    const sourceInfo = await sharp(sourcePath).metadata();
    const usableWidths = widths.filter((width) => !sourceInfo.width || width < sourceInfo.width);
    const finalWidths = usableWidths.length > 0
      ? [...usableWidths, sourceInfo.width].filter(Boolean)
      : [sourceInfo.width].filter(Boolean);
    const widthSet = [...new Set(finalWidths)];

    console.log(`\nProcessing ${relativePath.replaceAll(path.sep, '/')}`);
    console.log(`  Original size: ${sourceInfo.width ?? '?'}x${sourceInfo.height ?? '?'}`);
    console.log(`  Output widths: ${widthSet.join(', ')}`);

    manifest[relativePath.replaceAll(path.sep, '/')] = {
      original: relativePath.replaceAll(path.sep, '/'),
      width: sourceInfo.width ?? null,
      height: sourceInfo.height ?? null,
      variants: {},
    };

    for (const format of formats) {
      manifest[relativePath.replaceAll(path.sep, '/')].variants[format] = [];

      for (const width of widthSet) {
        const outputRelativePath = path.join(
          parsedPath.dir,
          `${parsedPath.name}-${width}.${format}`,
        );
        const outputPath = path.join(outputRoot, outputRelativePath);

        await generateVariant(sharp, sourcePath, outputPath, width, format);
        generatedCount += 1;

        const generatedStats = await stat(outputPath);
        console.log(`    -> ${path.join('images', 'responsive', outputRelativePath).replaceAll(path.sep, '/')} (${generatedStats.size} bytes)`);
        manifest[relativePath.replaceAll(path.sep, '/')].variants[format].push({
          width,
          path: path.join('images', 'responsive', outputRelativePath).replaceAll(path.sep, '/'),
          bytes: generatedStats.size,
        });
      }
    }
  }

  await writeFile(
    path.join(outputRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        widths,
        formats,
        images: manifest,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`\nGenerated ${generatedCount} responsive variants for ${Object.keys(manifest).length} images in ${outputRoot}`);
  console.log(`Manifest written to ${path.join(outputRoot, 'manifest.json')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
