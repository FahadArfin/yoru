import { deflateSync } from 'node:zlib';

// Original geometric page fixture; no external media is used in reader tests.
export function readerImage(width = 600, height = 900, seed = 0) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const edge = x < 25 || x > width - 25 || y < 25 || y > height - 25 || y % 300 < 15;
      const index = y * (width * 3 + 1) + 1 + x * 3;
      raw[index] = edge ? 235 : 55 + seed * 20;
      raw[index + 1] = edge ? 228 : 60 + (Math.floor(y / 20) % 100);
      raw[index + 2] = edge ? 215 : 90 + (Math.floor(x / 15) % 100);
    }
  const crc = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, data) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
