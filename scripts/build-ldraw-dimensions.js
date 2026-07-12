const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const input = path.resolve(process.argv[2] || 'data/ldraw-complete.zip');
const output = path.resolve(process.argv[3] || 'data/ldraw-dimensions.json');
const archive = fs.readFileSync(input);

function entriesFromZip(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Archive ZIP invalide.');
  const count = buffer.readUInt16LE(eocd + 10);
  if (count === 0xffff) throw new Error('Archive ZIP64 non prise en charge.');
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Entrée ZIP invalide à l’index ${index}.`);
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + filenameLength).toString('utf8').replace(/\\/g, '/').toLowerCase();
    if (!name.endsWith('/')) entries.set(name, { compression, compressedSize, localOffset });
    cursor += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

const entries = entriesFromZip(archive);
const rootPrefix = [...entries.keys()].some(name => name.startsWith('ldraw/parts/')) ? 'ldraw/' : '';

function extract(name) {
  const entry = entries.get(name);
  if (!entry) return null;
  const filenameLength = archive.readUInt16LE(entry.localOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + filenameLength + extraLength;
  const compressed = archive.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) return compressed.toString('utf8');
  if (entry.compression === 8) return zlib.inflateRawSync(compressed).toString('utf8');
  return null;
}

const emptyBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const validBounds = bounds => bounds && bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite);
const include = (bounds, point) => point.forEach((value, axis) => { bounds.min[axis] = Math.min(bounds.min[axis], value); bounds.max[axis] = Math.max(bounds.max[axis], value); });
const transform = (point, matrix) => [matrix[0] + matrix[3] * point[0] + matrix[4] * point[1] + matrix[5] * point[2], matrix[1] + matrix[6] * point[0] + matrix[7] * point[1] + matrix[8] * point[2], matrix[2] + matrix[9] * point[0] + matrix[10] * point[1] + matrix[11] * point[2]];
const corners = bounds => [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].flatMap(y => [bounds.min[2], bounds.max[2]].map(z => [x, y, z])));

function parse(text) {
  const points = [], references = [];
  String(text).split(/\r?\n/).forEach(line => {
    const fields = line.trim().split(/\s+/);
    const type = Number(fields[0]);
    if (type === 1 && fields.length >= 15) {
      const matrix = fields.slice(2, 14).map(Number);
      const reference = fields.slice(14).join(' ').replace(/\\/g, '/').toLowerCase();
      if (matrix.every(Number.isFinite)) references.push({ matrix, reference });
    } else if ([2, 3, 4, 5].includes(type)) {
      const pointCount = type === 2 || type === 5 ? 2 : type;
      const values = fields.slice(2, 2 + pointCount * 3).map(Number);
      for (let index = 0; index + 2 < values.length; index += 3) if (values.slice(index, index + 3).every(Number.isFinite)) points.push(values.slice(index, index + 3));
    }
  });
  return { points, references };
}

const memo = new Map();
function resolve(reference) {
  const clean = reference.replace(/\\/g, '/').toLowerCase();
  const candidates = clean.startsWith('s/') ? [`${rootPrefix}parts/${clean}`]
    : clean.startsWith('48/') || clean.startsWith('8/') ? [`${rootPrefix}p/${clean}`]
      : [`${rootPrefix}parts/${clean}`, `${rootPrefix}p/${clean}`];
  return candidates.find(candidate => entries.has(candidate)) || null;
}

function boundsFor(filename, stack = new Set()) {
  if (memo.has(filename)) return memo.get(filename);
  if (stack.has(filename) || stack.size > 50) return null;
  const text = extract(filename);
  if (!text) return null;
  const parsed = parse(text);
  const bounds = emptyBounds();
  parsed.points.forEach(point => include(bounds, point));
  const nextStack = new Set(stack).add(filename);
  parsed.references.forEach(({ matrix, reference }) => {
    const childPath = resolve(reference);
    const child = childPath ? boundsFor(childPath, nextStack) : null;
    if (validBounds(child)) corners(child).map(point => transform(point, matrix)).forEach(point => include(bounds, point));
  });
  const result = validBounds(bounds) ? bounds : null;
  memo.set(filename, result);
  return result;
}

const mainPrefix = `${rootPrefix}parts/`;
const mainParts = [...entries.keys()].filter(name => name.startsWith(mainPrefix) && !name.slice(mainPrefix.length).includes('/') && name.endsWith('.dat'));
const dimensions = {};
mainParts.forEach((filename, index) => {
  const bounds = boundsFor(filename);
  if (validBounds(bounds)) {
    const values = bounds.max.map((maximum, axis) => Number(((maximum - bounds.min[axis]) * 0.04).toFixed(3)));
    if (values.every(value => value > 0)) dimensions[path.basename(filename, '.dat')] = values;
  }
  if ((index + 1) % 1000 === 0) process.stdout.write(`\r${index + 1}/${mainParts.length}`);
});

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ _meta: { source: 'LDraw.org Official Parts Library', sourceUrl: 'https://library.ldraw.org/updates', generatedAt: new Date().toISOString(), unit: 'cm', license: 'CC BY 4.0' }, parts: dimensions })}\n`, 'utf8');
process.stdout.write(`\r${Object.keys(dimensions).length} dimensions écrites dans ${output}\n`);
