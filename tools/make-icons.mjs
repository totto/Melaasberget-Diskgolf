// Hand-rolled PNG encoder (no deps beyond Node's built-in zlib) to generate real PNG
// app icons -- iOS specifically requires PNG for home-screen/apple-touch-icon, SVG
// doesn't work there, and there's no image library available in this environment.
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines, each prefixed with filter-type byte 0 (none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Yellow disc with an orange rim, matching the favicon -- generous padding so it also
// works as a "maskable" adaptive icon on Android.
function drawDiscIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.42;
  const ringWidth = size * 0.045;
  const YELLOW = [0xff, 0xb7, 0x03];
  const ORANGE = [0xff, 0x5a, 0x1f];
  const BG = [0x8f, 0xb8, 0xd8]; // matches theme_color, so the safe-zone crop still looks intentional

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      let color;
      if (dist <= outerR - ringWidth) color = YELLOW;
      else if (dist <= outerR) color = ORANGE;
      else color = BG;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const OUT_DIR = new URL("../icons/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

for (const size of [192, 512]) {
  const rgba = drawDiscIcon(size);
  const png = encodePNG(size, size, rgba);
  writeFileSync(new URL(`icon-${size}.png`, OUT_DIR), png);
  console.log(`Wrote icon-${size}.png (${(png.length / 1024).toFixed(1)}KB)`);
}
