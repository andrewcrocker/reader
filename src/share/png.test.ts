import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from './png';

/** Reads back what encodePng wrote: the chunk types, the header, and the unfiltered RGB rows. */
function decode(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  const idat: Uint8Array[] = [];
  let w = 0;
  let h = 0;
  for (let o = 8; o < png.length; ) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    types.push(type);
    if (type === 'IHDR') [w, h] = [view.getUint32(o + 8), view.getUint32(o + 12)];
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = raw.subarray(y * (w * 3 + 1), (y + 1) * (w * 3 + 1));
    expect(row[0]).toBe(1);
    const out: number[] = [];
    for (let i = 0; i < w * 3; i++) out.push((row[1 + i] + (i >= 3 ? out[i - 3] : 0)) & 255);
    rows.push(out);
  }
  return { types, w, h, rows };
}

describe('encodePng', () => {
  it('writes a valid PNG that decodes back to the same pixels', async () => {
    // 3x2, RGBA; alpha is ignored.
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 250, 240, 230, 255, 1, 2, 3, 255]);
    const png = await encodePng(px, 3, 2);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { types, w, h, rows } = decode(png);
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect([w, h]).toEqual([3, 2]);
    expect(rows).toEqual([
      [255, 0, 0, 0, 255, 0, 0, 0, 255],
      [10, 20, 30, 250, 240, 230, 1, 2, 3],
    ]);
  });

  it('has correct chunk checksums (the IEND checksum is the well-known constant)', async () => {
    const png = await encodePng(new Uint8Array(4), 1, 1);
    expect([...png.subarray(-8)]).toEqual([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  });

  it('compresses a smooth gradient far below its raw size', async () => {
    const w = 400;
    const h = 200;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([20 + (x >> 4), 90 + (y >> 3), 80 + ((x + y) >> 5), 255], (y * w + x) * 4);
    const png = await encodePng(px, w, h);
    expect(png.length).toBeLessThan(w * h * 3 * 0.1);
  });
});
