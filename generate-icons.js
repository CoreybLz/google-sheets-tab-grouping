// Run once: node generate-icons.js
// Generates icons/icon16.png, icon48.png, icon128.png
// Requires: npm install canvas

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

function draw(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 16; // scale factor (base design at 16px)

  // Background rounded rect
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 0, 0, size, size, 3 * s);
  ctx.fill();

  // Bottom sheet strip (grey)
  ctx.fillStyle = '#e8eaed';
  roundRect(ctx, 1 * s, 8 * s, 14 * s, 6 * s, 1.5 * s);
  ctx.fill();

  // Left group chip (blue)
  ctx.fillStyle = '#1a73e8';
  roundRect(ctx, 1 * s, 8 * s, 6.5 * s, 6 * s, 1.5 * s);
  ctx.fill();

  // Left tab indicator (blue pill)
  ctx.fillStyle = '#1a73e8';
  roundRect(ctx, 1 * s, 5 * s, 5 * s, 2.5 * s, 1.2 * s);
  ctx.fill();

  // Right tab indicator (red pill)
  ctx.fillStyle = '#d93025';
  roundRect(ctx, 9 * s, 5 * s, 6 * s, 2.5 * s, 1.2 * s);
  ctx.fill();

  return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

for (const size of [16, 48, 128]) {
  const buf = draw(size);
  const out = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(out, buf);
  console.log(`Wrote ${out}`);
}
