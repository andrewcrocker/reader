// A small PNG encoder. The browser's canvas.toBlob writes the 1200x630 share card, with its soft gradients,
// at about 515 KB, because it barely compresses them. Filtering each row against the pixel to its left
// first (PNG's "Sub" filter) turns a smooth gradient into runs of 0 and 1 that deflate to about half of
// that, which is less to attach to a message and to save. `canvasToPng` falls back to canvas.toBlob where
// CompressionStream isn't there.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 8-bit RGB PNG from RGBA pixels (alpha is dropped: the card is opaque). */
export async function encodePng(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 1; // filter type 1: Sub
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const cur = rgba[(y * width + x) * 4 + c];
        const left = x ? rgba[(y * width + x - 1) * 4 + c] : 0;
        raw[row + 1 + x * 3 + c] = (cur - left) & 255;
      }
    }
  }
  // 'deflate' is the zlib format, which is what a PNG's IDAT holds.
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
