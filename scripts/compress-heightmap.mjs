import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';

const DATA_DIR = path.resolve(import.meta.dirname, '../src/three/data');
const BODIES = {
  moon: { file: 'moon-4096x2048.bin', cols: 4096, rows: 2048, unitsPerKm: 2000, radiusKm: 1737.4 },
  mars: { file: 'mars-4096x2048.bin', cols: 4096, rows: 2048, unitsPerKm: 1000, radiusKm: 3396.19 },
};

const { values } = parseArgs({
  options: {
    body: { type: 'string', default: 'moon' },
    downsample: { type: 'string', default: '1' },
    step: { type: 'string', default: '0.5' }, // metres per stored unit
    name: { type: 'string' },
  },
});
const SOURCE = BODIES[values.body];
if (!SOURCE) throw new Error(`Unknown body "${values.body}", expected one of ${Object.keys(BODIES).join(', ')}`);
const name = values.name ?? values.body;
const factor = Number(values.downsample);
const stepM = Number(values.step);

const raw = fs.readFileSync(path.join(DATA_DIR, SOURCE.file));
const src = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const srcStride = SOURCE.cols + 1;
const at = (r, c) => {
  r = Math.min(Math.max(r, 0), SOURCE.rows);
  c = ((c % SOURCE.cols) + SOURCE.cols) % SOURCE.cols;
  return src[r * srcStride + c];
};

const cols = SOURCE.cols / factor;
const rows = SOURCE.rows / factor;
const stride = cols + 1;
const unitsPerKm = 1000 / stepM;
const toUnits = unitsPerKm / SOURCE.unitsPerKm;

const taps = [];
for (let o = -(factor - 1); o <= factor - 1; o++) taps.push([o, factor - Math.abs(o)]);

const heights = new Int16Array(stride * (rows + 1));
let min = Infinity;
let max = -Infinity;
for (let r = 0; r <= rows; r++) {
  for (let c = 0; c <= cols; c++) {
    let sum = 0;
    let weight = 0;
    for (const [dy, wy] of taps) {
      for (const [dx, wx] of taps) {
        sum += at(r * factor + dy, c * factor + dx) * wy * wx;
        weight += wy * wx;
      }
    }
    const value = Math.round((sum / weight) * toUnits);
    if (value < -32768 || value > 32767) throw new Error(`${value} overflows int16, use a coarser --step`);
    heights[r * stride + c] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
}

const n = heights.length;
const packed = new Uint8Array(n * 2);
for (let r = 0; r <= rows; r++) {
  let prev = 0;
  for (let c = 0; c <= cols; c++) {
    const i = r * stride + c;
    const delta = (heights[i] - prev) & 0xffff;
    packed[i] = delta & 0xff;
    packed[n + i] = delta >> 8;
    prev = heights[i];
  }
}

const file = `${name === values.body ? `${values.body}-${cols}x${rows}` : name}.bin.gz`;
const gz = zlib.gzipSync(packed, { level: 9 });
fs.writeFileSync(path.join(DATA_DIR, file), gz);

const meta = {
  file,
  cols,
  rows,
  vertexCount: n,
  format: 'int16le-rowdelta-split-gzip',
  unitsPerKm,
  radiusKm: SOURCE.radiusKm,
  minKm: min / unitsPerKm,
  maxKm: max / unitsPerKm,
};
fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(meta, null, 2) + '\n');

console.log(`${file}: ${(raw.length / 1e6).toFixed(2)} MB -> ${(gz.length / 1e6).toFixed(2)} MB`);
