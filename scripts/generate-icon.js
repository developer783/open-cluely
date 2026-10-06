'use strict';

// Generates assets/icon.png (1024x1024) with no external dependencies.
// electron-builder converts it to .ico (Windows) and .icns (macOS) at build time.
// Replace assets/icon.png with your own artwork to customise the app icon.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function insideRoundedRect(x, y, inset, radius) {
  const min = inset;
  const max = SIZE - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function pixel(x, y) {
  if (!insideRoundedRect(x, y, 64, 200)) return [0, 0, 0, 0];

  // Diagonal indigo -> violet gradient background.
  const t = (x + y) / (2 * SIZE);
  let r = Math.round(79 + (139 - 79) * t);
  let g = Math.round(70 + (92 - 70) * t);
  let b = Math.round(229 + (246 - 229) * t);

  // White speech bubble with a tail.
  const inBubble = insideRoundedRect(x, y + 60, 250, 120) && y < SIZE - 330;
  const inTail = y >= 690 && y <= 800 && x >= 330 && x <= 330 + (800 - y) * 0.9;
  if (inBubble || inTail) {
    r = 255; g = 255; b = 255;
    // Three dots inside the bubble.
    for (const dx of [-140, 0, 140]) {
      if ((x - (512 + dx)) ** 2 + (y - 470) ** 2 <= 44 ** 2) {
        r = 99; g = 82; b = 238;
      }
    }
  }

  return [r, g, b, 255];
}

function buildPng() {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const outputPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buildPng());
console.log(`[generate-icon] Wrote ${outputPath}`);
