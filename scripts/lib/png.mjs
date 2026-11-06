// A minimal PNG writer and reader for the art scripts, with no dependencies. The writer makes 8-bit
// RGB or RGBA in one IDAT chunk. The reader takes the non-interlaced 8-bit PNGs art tools export.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A minimal PNG: signature, IHDR, one IDAT, IEND. `pixelAt(x, y)` returns [r, g, b], or
 * [r, g, b, a] when `alpha` is set.
 */
export function encodePng(width, height, pixelAt, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(x, y);
      for (let channel = 0; channel < channels; channel += 1) raw[row + 1 + x * channels + channel] = pixel[channel] ?? 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** Undoes PNG's per-row filters in place; `stride` is the bytes in a row, `step` the bytes in a pixel. */
function unfilter(data, height, stride, step) {
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = data[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const value = data[y * (stride + 1) + 1 + i];
      const left = i >= step ? rows[y * stride + i - step] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= step ? rows[(y - 1) * stride + i - step] : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predicted === undefined) throw new Error(`unknown PNG row filter ${filter}`);
      rows[y * stride + i] = (value + predicted) & 0xff;
    }
  }
  return rows;
}

/** Reads a PNG into { width, height, rgba }, where rgba has four bytes per pixel. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let header = null;
  let palette = null;
  let transparency = null;
  const data = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  const { width, height, depth, colour, interlace } = header;
  const channels = CHANNELS[colour];
  if (depth !== 8 || channels === undefined) throw new Error(`PNG is ${depth}-bit colour type ${colour}; save it as 8-bit RGBA, RGB, grey or indexed`);
  if (interlace !== 0) throw new Error('PNG is interlaced; save it without interlacing');
  if (colour === 3 && !palette) throw new Error('indexed PNG has no palette');
  const rows = unfilter(inflateSync(Buffer.concat(data)), height, width * channels, channels);
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const from = pixel * channels;
    const to = pixel * 4;
    if (colour === 3) {
      const index = rows[from];
      rgba.set([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], transparency && index < transparency.length ? transparency[index] : 255], to);
    } else if (colour === 0 || colour === 4) {
      rgba.set([rows[from], rows[from], rows[from], colour === 4 ? rows[from + 1] : 255], to);
    } else {
      rgba.set([rows[from], rows[from + 1], rows[from + 2], colour === 6 ? rows[from + 3] : 255], to);
    }
  }
  return { width, height, rgba };
}
