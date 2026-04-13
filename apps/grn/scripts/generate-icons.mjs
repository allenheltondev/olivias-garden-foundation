import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function generateIcon(size) {
  const png = new PNG({ width: size, height: size });

  // Fill with green background (#10b981)
  const bgColor = { r: 16, g: 185, b: 129, a: 255 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Default to background
      let color = bgColor;

      // Draw a simple white plant/leaf shape
      const centerX = size / 2;
      const centerY = size / 2;
      const scale = size / 192;

      // Stem (vertical rectangle)
      if (x >= centerX - 8 * scale && x <= centerX + 8 * scale &&
          y >= centerY - 20 * scale && y <= centerY + 40 * scale) {
        color = { r: 255, g: 255, b: 255, a: 255 };
      }

      // Left leaf (ellipse)
      const dx1 = (x - (centerX - 30 * scale)) / (25 * scale);
      const dy1 = (y - (centerY - 10 * scale)) / (15 * scale);
      if (dx1 * dx1 + dy1 * dy1 <= 1) {
        color = { r: 255, g: 255, b: 255, a: 255 };
      }

      // Right leaf (ellipse)
      const dx2 = (x - (centerX + 30 * scale)) / (25 * scale);
      const dy2 = (y - (centerY - 10 * scale)) / (15 * scale);
      if (dx2 * dx2 + dy2 * dy2 <= 1) {
        color = { r: 255, g: 255, b: 255, a: 255 };
      }

      // Top leaf (ellipse)
      const dx3 = (x - centerX) / (20 * scale);
      const dy3 = (y - (centerY - 40 * scale)) / (25 * scale);
      if (dx3 * dx3 + dy3 * dy3 <= 1) {
        color = { r: 255, g: 255, b: 255, a: 255 };
      }

      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = color.a;
    }
  }

  const iconsDir = join(__dirname, '..', 'public', 'icons');
  mkdirSync(iconsDir, { recursive: true });

  const buffer = PNG.sync.write(png);
  const outputPath = join(iconsDir, `icon-${size}x${size}.png`);
  writeFileSync(outputPath, buffer);
  console.log(`Generated ${size}x${size} icon`);
}

generateIcon(192);
generateIcon(512);
console.log('Icons generated successfully!');
