import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from './png.mjs';

const at = (image, x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

const pixel = (x, y) => [x * 40, y * 60, (x + y) * 10, x === 0 ? 0 : 255];
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
};

describe('png', () => {
  it('reads back what it writes, with and without alpha', () => {
    const rgb = decodePng(encodePng(5, 3, pixel));
    const rgba = decodePng(encodePng(5, 3, pixel, { alpha: true }));
    expect([rgb.width, rgb.height]).toEqual([5, 3]);
    expect(at(rgb, 2, 1)).toEqual([80, 60, 30, 255]);
    expect(at(rgb, 0, 2)).toEqual([0, 120, 20, 255]);
    expect(at(rgba, 0, 2)).toEqual([0, 120, 20, 0]);
    expect(at(rgba, 4, 2)).toEqual([160, 120, 60, 255]);
  });

  it('reads an indexed PNG with transparency, every row filter included', () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(5, 4);
    header.set([8, 3, 0, 0, 0], 8);
    // Five rows of two indices, one row per filter type. Every row decodes to [1, 0].
    const raw = Buffer.from([0, 1, 0, 1, 1, 255, 2, 0, 0, 3, 1, 0, 4, 0, 0]);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('PLTE', Buffer.from([10, 20, 30, 200, 100, 50])),
      chunk('tRNS', Buffer.from([0])),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const image = decodePng(png);
    for (let y = 0; y < 5; y += 1) {
      expect(at(image, 0, y)).toEqual([200, 100, 50, 255]);
      expect(at(image, 1, y)).toEqual([10, 20, 30, 0]);
    }
  });

  it('refuses what it cannot read', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow('not a PNG');
  });
});
