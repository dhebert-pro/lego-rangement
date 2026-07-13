const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.local.json');
const LOCATIONS_PATH = path.join(__dirname, 'locations.local.json');
const PROGRESS_PATH = path.join(__dirname, 'progress.local.json');
const SET_INVENTORIES_PATH = path.join(__dirname, 'set-inventories.local.json');
const MOVE_HISTORY_PATH = path.join(__dirname, 'move-history.local.json');
const LOCATION_OVERRIDES_PATH = path.join(__dirname, 'location-overrides.local.json');
const PART_CATALOG_PATH = path.join(__dirname, 'part-catalog.local.json');
const COLOR_IMAGES_PATH = path.join(__dirname, 'color-images.local.json');
const LDRAW_DIMENSIONS_PATH = path.join(__dirname, 'data', 'ldraw-dimensions.json');
const STUDIO_META_PATH = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Stud.io', 'BLBrickMetaInfo') : path.join(os.homedir(), 'AppData', 'Local', 'Stud.io', 'BLBrickMetaInfo');

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function isLoopback(req) {
  const address = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1';
}

function networkUrls() {
  const urls = [];
  Object.values(os.networkInterfaces()).flat().forEach(address => {
    if (!address || address.family !== 'IPv4' || address.internal) return;
    const value = address.address;
    const privateAddress = /^10\./.test(value) || /^192\.168\./.test(value) || /^172\.(1[6-9]|2\d|3[01])\./.test(value);
    if (privateAddress) urls.push(`http://${value}:${PORT}`);
  });
  const rank = url => url.includes('//192.168.') ? 0 : url.includes('//10.') ? 1 : 2;
  return [...new Set(urls)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function savedConfig() {
  return readJson(CONFIG_PATH).rebrickable || {};
}

function saveConfig(rebrickable) {
  const config = readJson(CONFIG_PATH);
  config.rebrickable = rebrickable;
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function createUserToken(apiKey, username, password) {
  const body = new URLSearchParams({ username, password });
  const data = await requestJson('https://rebrickable.com/api/v3/users/_token/', apiKey, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const userToken = data.user_token || data.token;
  if (!userToken) throw Object.assign(new Error('Rebrickable n’a pas renvoyé de jeton utilisateur.'), { status: 502 });
  return userToken;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestJson(url, apiKey, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `key ${apiKey}`, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    const temporary = [429, 502, 503, 504].includes(response.status);
    if (temporary && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1));
      continue;
    }
    const message = temporary
      ? 'Rebrickable est temporairement indisponible. Réessayez dans quelques instants.'
      : data.detail || `Erreur Rebrickable (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status });
  }
}

async function getAll(url, apiKey) {
  const results = [];
  let next = url;
  while (next) {
    const data = await requestJson(next, apiKey);
    results.push(...(data.results || []));
    next = data.next;
    if (next) await wait(1050);
  }
  return results;
}

const LDRAW_TO_CM = 0.04;

function externalId(part, source) {
  const external = part?.part?.external_ids?.[source] ?? part?.external_ids?.[source];
  const candidate = Array.isArray(external) ? external[0] : external;
  return candidate == null || String(candidate).trim() === '' ? null : String(candidate).trim();
}

const emptyBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const validBounds = bounds => bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite);

function includePoint(bounds, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
}

function transformPoint(point, transform) {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = transform;
  return [x + a * point[0] + b * point[1] + c * point[2], y + d * point[0] + e * point[1] + f * point[2], z + g * point[0] + h * point[1] + i * point[2]];
}

function corners(bounds) {
  const result = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) result.push([x, y, z]);
  return result;
}

function parseLDraw(text) {
  const points = [];
  const references = [];
  String(text).split(/\r?\n/).forEach(line => {
    const fields = line.trim().split(/\s+/);
    const type = Number(fields[0]);
    if (type === 1 && fields.length >= 15) {
      const transform = fields.slice(2, 14).map(Number);
      const reference = fields.slice(14).join(' ').replace(/\\/g, '/').toLowerCase();
      if (transform.every(Number.isFinite) && reference) references.push({ transform, reference });
    } else if ([2, 3, 4, 5].includes(type)) {
      const pointCount = type === 2 || type === 5 ? 2 : type;
      const coordinates = fields.slice(2, 2 + pointCount * 3).map(Number);
      for (let index = 0; index + 2 < coordinates.length; index += 3) {
        const point = coordinates.slice(index, index + 3);
        if (point.every(Number.isFinite)) points.push(point);
      }
    }
  });
  return { points, references };
}

function combineLDrawBounds(text, referencedBounds = {}) {
  const parsed = parseLDraw(text);
  const bounds = emptyBounds();
  parsed.points.forEach(point => includePoint(bounds, point));
  parsed.references.forEach(({ transform, reference }) => {
    const child = referencedBounds[reference];
    if (child && validBounds(child)) corners(child).map(point => transformPoint(point, transform)).forEach(point => includePoint(bounds, point));
  });
  return validBounds(bounds) ? bounds : null;
}

function physicalFromLDrawBounds(bounds, ldrawNo) {
  if (!bounds || !validBounds(bounds)) return null;
  const dimensionsCm = bounds.max.map((maximum, axis) => Number(((maximum - bounds.min[axis]) * LDRAW_TO_CM).toFixed(3)));
  if (!dimensionsCm.every(value => value > 0)) return null;
  return {
    source: 'LDraw',
    ldrawNo: String(ldrawNo || ''),
    dimensionsCm,
    volumeCm3: Number(dimensionsCm.reduce((product, value) => product * value, 1).toFixed(3))
  };
}

let ldrawDimensions;
function dimensionsCatalog() {
  if (!ldrawDimensions) ldrawDimensions = readJson(LDRAW_DIMENSIONS_PATH, { parts: {} });
  return ldrawDimensions.parts || {};
}

function studioMetadata(bricklinkNo) {
  if (!bricklinkNo || !/^[a-z0-9_.-]+$/i.test(bricklinkNo)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(STUDIO_META_PATH, bricklinkNo), 'utf8').replace(/^\uFEFF/, ''));
  } catch { return null; }
}

function enrichWithPhysicalData(parts) {
  const catalog = dimensionsCatalog();
  const enriched = parts.map(part => {
    const ldrawNo = externalId(part, 'LDraw');
    const bricklinkNo = externalId(part, 'BrickLink');
    const key = String(ldrawNo || '').toLowerCase().replace(/\.dat$/, '');
    const studio = studioMetadata(bricklinkNo);
    const catalogDimensions = catalog[key];
    const modularDimensions = [Number(studio?.DimX), Number(studio?.DimY), Number(studio?.DimZ)];
    const studioDimensions = modularDimensions.every(value => Number.isFinite(value) && value > 0)
      ? [Number((modularDimensions[0] * 0.8).toFixed(3)), Number((modularDimensions[1] * 0.8).toFixed(3)), Number((modularDimensions[2] * 0.96).toFixed(3))]
      : null;
    const dimensionsCm = catalogDimensions || studioDimensions;
    const weightG = Number(studio?.Weight) > 0 ? Number(studio.Weight) : null;
    const physical = dimensionsCm ? {
      source: catalogDimensions ? (weightG ? 'LDraw + cache Studio' : 'LDraw') : 'cache Studio',
      ldrawNo,
      dimensionsCm,
      volumeCm3: Number(dimensionsCm.reduce((product, value) => product * value, 1).toFixed(3)),
      weightG
    } : null;
    return {
      ...part,
      physical,
      ldrawNo,
      bricklinkNo,
      bricklinkUrl: bricklinkNo ? `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(bricklinkNo)}` : null
    };
  });
  return {
    parts: enriched,
    status: {
      source: 'catalogue LDraw embarqué',
      available: enriched.filter(part => part.physical?.dimensionsCm?.every(Boolean)).length,
      weights: enriched.filter(part => part.physical?.weightG).length,
      total: enriched.length
    }
  };
}

async function login(req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw || '{}');
  const local = savedConfig();
  const apiKey = input.apiKey || process.env.REBRICKABLE_API_KEY || local.apiKey;
  if (!apiKey || !input.username || !input.password) {
    return send(res, 400, { error: 'Renseignez la clé API, l’identifiant et le mot de passe.' });
  }
  try {
    const userToken = await createUserToken(apiKey, input.username, input.password);
    send(res, 200, { userToken });
  } catch (error) {
    send(res, error.status || 502, { error: error.message || 'Impossible de joindre Rebrickable.' });
  }
}

async function savedLogin(res) {
  const local = savedConfig();
  if (!local.apiKey || (!local.userToken && (!local.username || !local.password))) {
    return send(res, 404, { error: 'Aucune connexion enregistrée.' });
  }
  try {
    if (!local.userToken) {
      local.userToken = await createUserToken(local.apiKey, local.username, local.password);
      delete local.password;
      saveConfig(local);
    }
    send(res, 200, { connected: true, partListId: local.partListId || 108467 });
  } catch (error) {
    send(res, error.status || 502, { error: error.message || 'Connexion enregistrée invalide.' });
  }
}

function parseCsv(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const candidates = [',', ';', '\t'];
  const delimiter = candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value); if (row.some(cell => cell.trim())) rows.push(row); row = []; value = '';
    } else value += char;
  }
  row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

const normalized = value => String(value || '').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const mappingIdentity = item => `${String(item.partNum || '').trim()}|${item.colorId == null ? `name:${String(item.colorName || '').trim().toLocaleLowerCase('fr')}` : `id:${Number(item.colorId)}`}`;

function applyLocationOverrides(mappings) {
  const overrides = readJson(LOCATION_OVERRIDES_PATH, { mappings: [] }).mappings || [];
  const byIdentity = new Map(overrides.map(item => [mappingIdentity(item), item.location]));
  return (mappings || []).map(mapping => byIdentity.has(mappingIdentity(mapping)) ? { ...mapping, location: byIdentity.get(mappingIdentity(mapping)) } : mapping);
}

function importLocations(content) {
  const mappings = applyLocationOverrides(mappingsFromCsv(content));
  fs.writeFileSync(LOCATIONS_PATH, `${JSON.stringify({ importedAt: new Date().toISOString(), mappings }, null, 2)}\n`, 'utf8');
  return mappings.length;
}

function mappingsFromCsv(content) {
  const rows = parseCsv(content);
  if (rows.length < 2) throw new Error('Le fichier CSV est vide.');
  const headers = rows[0].map(normalized);
  const indexOf = aliases => headers.findIndex(header => aliases.includes(header));
  const partIndex = indexOf(['part', 'partnum', 'partnumber', 'designid', 'numero', 'numerodepiece']);
  const colorIdIndex = indexOf(['colorid', 'colourid', 'rebrickablecolorid', 'rbcolorid']);
  const colorIndex = indexOf(['color', 'colour', 'colorname', 'colourname', 'couleur']);
  const quantityIndex = indexOf(['quantity', 'qty', 'quantite']);
  let locationIndex = indexOf(['location', 'storagelocation', 'emplacement', 'case', 'bin', 'drawer']);
  if (locationIndex < 0) locationIndex = indexOf(['note', 'notes']);
  if (partIndex < 0 || locationIndex < 0) throw new Error('Colonnes Part et Location introuvables dans ce CSV.');
  const mappings = rows.slice(1).map(row => {
    const explicitColorId = colorIdIndex >= 0 ? String(row[colorIdIndex] || '').trim() : '';
    const colorValue = colorIndex >= 0 ? String(row[colorIndex] || '').trim() : '';
    const numericColor = explicitColorId || (/^-?\d+$/.test(colorValue) ? colorValue : '');
    return {
      partNum: String(row[partIndex] || '').trim(),
      colorId: /^-?\d+$/.test(numericColor) ? Number(numericColor) : null,
      colorName: numericColor ? '' : colorValue,
      quantity: quantityIndex >= 0 && Number.isFinite(Number(row[quantityIndex])) ? Number(row[quantityIndex]) : null,
      location: String(row[locationIndex] || '').trim()
    };
  }).filter(item => item.partNum && item.location);
  if (!mappings.length) throw new Error('Aucun emplacement renseigné trouvé dans ce CSV.');
  return mappings;
}

function setPartsFromCsv(content) {
  const rows = parseCsv(content);
  if (rows.length < 2) throw new Error('Le fichier CSV du set est vide.');
  const headers = rows[0].map(normalized);
  const indexOf = aliases => headers.findIndex(header => aliases.includes(header));
  const partIndex = indexOf(['part', 'partnum', 'partnumber']);
  const colorIndex = indexOf(['color', 'colorid', 'colour', 'colourid']);
  const quantityIndex = indexOf(['quantity', 'qty']);
  const spareIndex = indexOf(['isspare', 'spare']);
  if (partIndex < 0 || colorIndex < 0 || quantityIndex < 0) throw new Error('Colonnes Part, Color et Quantity introuvables dans le CSV du set.');
  return rows.slice(1).map(row => ({
    partNum: String(row[partIndex] || '').trim(),
    colorId: Number(row[colorIndex]),
    quantity: Number(row[quantityIndex]),
    isSpare: spareIndex >= 0 && /^(true|1|yes)$/i.test(String(row[spareIndex] || '').trim())
  })).filter(item => item.partNum && Number.isFinite(item.colorId) && Number.isFinite(item.quantity) && item.quantity > 0 && !item.isSpare);
}

function inventoryFromUrl(value) {
  try {
    const url = new URL(String(value));
    const inventory = url.searchParams.get('inventory');
    return inventory && /^\d+$/.test(inventory) ? Number(inventory) : null;
  } catch { return null; }
}

function importSetInventory(sourceUrl, content) {
  const setNum = cleanSetNumber(sourceUrl);
  const inventory = inventoryFromUrl(sourceUrl);
  if (inventory == null) throw new Error('Le lien du set ne contient pas de paramètre inventory.');
  const parts = setPartsFromCsv(content);
  if (!parts.length) throw new Error('Aucune pièce trouvée dans l’export de cette version.');
  const cache = readJson(SET_INVENTORIES_PATH, { inventories: {} });
  cache.inventories ||= {};
  cache.inventories[`${setNum}|${inventory}`] = { setNum, inventory, sourceUrl, importedAt: new Date().toISOString(), parts };
  fs.writeFileSync(SET_INVENTORIES_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return { count: parts.length, setNum, inventory };
}

function cleanModel(value) {
  const text = String(value || '');
  const moc = text.match(/(?:mocs\/)?(MOC-\d+)/i);
  if (moc) return { type: 'moc', id: moc[1].toUpperCase() };
  return { type: 'set', id: cleanSetNumber(text) };
}

function withoutSpares(parts) {
  return (parts || []).filter(part => !part?.is_spare && !part?.isSpare);
}

function importModelInventory(sourceUrl, content, metadata = {}) {
  const model = cleanModel(sourceUrl);
  if (model.type !== 'moc') throw new Error('Ce lien n’est pas un MOC Rebrickable.');
  const parts = setPartsFromCsv(content);
  if (!parts.length) throw new Error('Aucune pièce hors spare trouvée dans l’export du MOC.');
  const cache = readJson(SET_INVENTORIES_PATH, { inventories: {}, models: {} });
  cache.models ||= {};
  cache.models[model.id] = {
    modelId: model.id,
    sourceUrl,
    importedAt: new Date().toISOString(),
    name: String(metadata.name || model.id).trim(),
    imageUrl: String(metadata.imageUrl || '').trim(),
    parts
  };
  fs.writeFileSync(SET_INVENTORIES_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return { count: parts.length, modelId: model.id };
}

function importLocationMappings(input) {
  const mappings = applyLocationOverrides((Array.isArray(input) ? input : []).map(item => ({
    partNum: String(item.partNum || '').trim(),
    colorId: Number.isInteger(Number(item.colorId)) && String(item.colorId).trim() !== '' ? Number(item.colorId) : null,
    colorName: String(item.colorName || '').trim(),
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
    location: String(item.location || '').trim()
  })).filter(item => item.partNum && item.location));
  if (!mappings.length) throw new Error('Aucun emplacement détecté sur la page Rebrickable.');
  fs.writeFileSync(LOCATIONS_PATH, `${JSON.stringify({ importedAt: new Date().toISOString(), mappings }, null, 2)}\n`, 'utf8');
  return mappings.length;
}

function upsertLocationMapping(mappings, input) {
  const mapping = {
    partNum: String(input.partNum || '').trim(),
    colorId: Number.isInteger(Number(input.colorId)) && String(input.colorId).trim() !== '' ? Number(input.colorId) : null,
    colorName: String(input.colorName || '').trim(),
    location: String(input.location || '').trim()
  };
  if (!mapping.partNum) throw new Error('Numéro de pièce manquant.');
  if (!mapping.location) throw new Error('Indiquez un numéro de case.');
  const samePartColor = item => item.partNum === mapping.partNum && (
    mapping.colorId != null ? Number(item.colorId) === mapping.colorId : String(item.colorName || '').toLowerCase() === mapping.colorName.toLowerCase()
  );
  return [...(mappings || []).filter(item => !samePartColor(item)), mapping];
}

function assignLocation(input) {
  const current = readJson(LOCATIONS_PATH, { mappings: [] });
  const mappings = upsertLocationMapping(current.mappings, input);
  fs.writeFileSync(LOCATIONS_PATH, `${JSON.stringify({ ...current, importedAt: new Date().toISOString(), mappings }, null, 2)}\n`, 'utf8');
  return { mapping: mappings[mappings.length - 1], count: mappings.length };
}

function occupiedCases(mappings) {
  const byLocation = new Map();
  for (const mapping of mappings || []) {
    const location = String(mapping.location || '').trim();
    const partNum = String(mapping.partNum || '').trim();
    if (!location || !partNum || /^sans case$/i.test(location)) continue;
    const key = location.toLocaleLowerCase('fr');
    if (!byLocation.has(key)) byLocation.set(key, { location, references: new Set(), parts: new Set(), colors: new Set() });
    const item = byLocation.get(key);
    const color = mapping.colorId == null ? `name:${String(mapping.colorName || '').trim().toLocaleLowerCase('fr')}` : `id:${mapping.colorId}`;
    item.references.add(`${partNum}|${color}`);
    item.parts.add(partNum);
    item.colors.add(color);
  }
  return [...byLocation.values()].map(item => ({
    location: item.location,
    referenceCount: item.references.size,
    partCount: item.parts.size,
    colorCount: item.colors.size
  })).sort((a, b) => a.location.localeCompare(b.location, 'fr', { numeric: true }));
}

function storageCaseUniverse() {
  const prefixes = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'AB'].map((letter, index) => index < 26 ? letter : `A${letter}`);
  return ['1', '2', '3', ...prefixes.flatMap(prefix => Array.from({ length: 9 }, (_, index) => `${prefix}${index + 1}`))];
}

function inferredEmptyCases(mappings) {
  const occupied = new Set(occupiedCases(mappings).map(item => item.location.toLocaleUpperCase()));
  return storageCaseUniverse().filter(location => !occupied.has(location)).map(location => ({ location }));
}

function moveStorageMappings(mappings, input) {
  const fromLocation = String(input.fromLocation || '').trim();
  const toLocation = String(input.toLocation || '').trim();
  if (!fromLocation || !toLocation) throw new Error('Indiquez les cases de départ et d’arrivée.');
  if (fromLocation.length > 80 || toLocation.length > 80) throw new Error('Numéro de case invalide.');
  if (fromLocation.toLocaleLowerCase('fr') === toLocation.toLocaleLowerCase('fr')) throw new Error('La nouvelle case doit être différente.');
  if (!Array.isArray(input.items) || !input.items.length) throw new Error('Sélectionnez au moins une pièce.');
  const selected = new Set(input.items.map(mappingIdentity));
  const moved = [];
  const next = (mappings || []).map(mapping => {
    if (String(mapping.location || '').toLocaleLowerCase('fr') !== fromLocation.toLocaleLowerCase('fr') || !selected.has(mappingIdentity(mapping))) return mapping;
    moved.push({ ...mapping, fromLocation: mapping.location, toLocation });
    return { ...mapping, location: toLocation };
  });
  if (!moved.length) throw new Error('Aucune pièce sélectionnée n’a été trouvée dans cette case.');
  return { mappings: next, moved, sourceEmpty: !next.some(mapping => String(mapping.location || '').toLocaleLowerCase('fr') === fromLocation.toLocaleLowerCase('fr')) };
}

async function storageCatalog() {
  const cached = readJson(PART_CATALOG_PATH, { items: [] });
  if (cached.items?.length) return cached.items;
  const local = savedConfig();
  if (!local.apiKey || !local.userToken) return cached.items || [];
  try {
    const partListId = Number(local.partListId || 108467);
    const parts = await getAll(`https://rebrickable.com/api/v3/users/${encodeURIComponent(local.userToken)}/partlists/${partListId}/parts/?page_size=500`, local.apiKey);
    const items = parts.map(item => ({
      partNum: String(item.part?.part_num || ''),
      colorId: item.color?.id == null ? null : Number(item.color.id),
      colorName: String(item.color?.name || ''),
      name: String(item.part?.name || item.part?.part_num || ''),
      imageUrl: String(item.part?.part_img_url || ''),
      quantity: Number(item.quantity) || null,
      bricklinkId: item.part?.external_ids?.BrickLink?.[0] || ''
    })).filter(item => item.partNum);
    fs.writeFileSync(PART_CATALOG_PATH, `${JSON.stringify({ syncedAt: new Date().toISOString(), items }, null, 2)}\n`, 'utf8');
    return items;
  } catch {
    return cached.items || [];
  }
}

async function storageCase(location) {
  const requested = String(location || '').trim();
  if (!requested) throw new Error('Indiquez une case.');
  if (requested.length > 80) throw new Error('Numéro de case invalide.');
  const mappings = readJson(LOCATIONS_PATH, { mappings: [] }).mappings || [];
  const matches = mappings.filter(mapping => String(mapping.location || '').toLocaleLowerCase('fr') === requested.toLocaleLowerCase('fr'));
  const catalog = await storageCatalog();
  const exact = new Map(catalog.map(item => [mappingIdentity(item), item]));
  const byPart = new Map(catalog.map(item => [item.partNum, item]));
  return {
    location: matches[0]?.location || requested,
    items: matches.map(mapping => {
      const detail = exact.get(mappingIdentity(mapping)) || byPart.get(mapping.partNum) || {};
      const dimensionsCm = dimensionsCatalog()[String(mapping.partNum || '').toLowerCase().replace(/\.dat$/, '')] || null;
      return {
        partNum: mapping.partNum,
        colorId: mapping.colorId,
        colorName: detail.colorName || mapping.colorName || '',
        name: detail.name || mapping.partNum,
        imageUrl: mapping.colorId == null ? detail.imageUrl || '' : `/api/storage/image?partNum=${encodeURIComponent(mapping.partNum)}&colorId=${encodeURIComponent(mapping.colorId)}`,
        quantity: mapping.quantity ?? detail.quantity ?? null,
        physical: dimensionsCm ? { dimensionsCm, volumeCm3: Number(dimensionsCm.reduce((product, value) => product * value, 1).toFixed(3)) } : null,
        bricklinkUrl: detail.bricklinkId ? `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(detail.bricklinkId)}` : ''
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
  };
}

const normalizeSplitText = value => String(value || '').toLocaleLowerCase('en').normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');

function splitShapeKey(partNum) {
  return String(partNum || '').toLocaleLowerCase('fr').replace(/pr\d.*$/i, '').replace(/[a-z]$/i, '');
}

function splitFamily(name) {
  const value = normalizeSplitText(name);
  const rules = [
    [/animal|bird|dragon|dinosaur|tail\b|wing\b|horn\b|claw|paw|hoof|beak|droid|skeleton|minifig|torso|head\b|arm\b|leg\b/, ['figure', 'Parties d’animaux, de droïdes ou de figurines', 'personnages']],
    [/technic|axle|pin\b|liftarm|gear|rack|connector|bionicle/, ['technic', 'Pièces LEGO Technic', 'mécanique']],
    [/clip|bar\b|handle|hinge|joint|lever|hook|towball/, ['grip', 'Clips, barres et articulations', 'mécanique']],
    [/wheel|tire|tyre|rim|hub|mudguard|track/, ['wheel', 'Roues et éléments roulants', 'mécanique']],
    [/plate/, ['plate', 'Plaques', 'construction']],
    [/tile|macaroni|grille|grill/, ['tile', 'Tuiles et surfaces lisses', 'construction']],
    [/brick/, ['brick', 'Briques', 'construction']],
    [/slope|wedge|arch|curve|curved|bow\b/, ['slope', 'Pentes et formes courbes', 'construction']],
    [/cone|cylinder|dish|round|ball|sphere/, ['round', 'Pièces rondes et cylindriques', 'construction']],
    [/plant|flower|leaf|food|weapon|sword|gun\b|shield|window|door|panel|fence/, ['decor', 'Décor et accessoires', 'personnages']]
  ];
  const match = rules.find(([pattern]) => pattern.test(value));
  const [key, label, domain] = match?.[1] || ['special', 'Formes spéciales', 'spécial'];
  return { key, label, domain };
}

function splitFeatures(name) {
  const value = normalizeSplitText(name);
  const topOpening = /hollow stud|open stud|open o stud|stud[^,]*(hole|open)|hole on top|top hole|upper hole|round opening/.test(value);
  const hole = topOpening || /hole|opening|hollow|socket|axle connector|pin connector/.test(value);
  return {
    topOpening,
    hole,
    technic: /technic|axle|pin\b|liftarm|gear|rack|connector|bionicle/.test(value),
    figure: /animal|bird|dragon|dinosaur|tail\b|wing\b|horn\b|claw|paw|hoof|beak|droid|skeleton|minifig|torso|head\b|arm\b|leg\b/.test(value),
    grip: /clip|bar\b|handle|hinge|joint|lever|hook|towball/.test(value)
  };
}

function splitColorBucket(colorName) {
  const value = normalizeSplitText(colorName);
  if (/black|dark bluish gray|dark gray|gun metal/.test(value)) return 'neutres sombres';
  if (/white|light bluish gray|light gray|silver|pearl/.test(value)) return 'neutres claires';
  if (/red|coral|magenta|pink/.test(value)) return 'rouges et roses';
  if (/orange|yellow|tan|gold/.test(value)) return 'jaunes et orangées';
  if (/green|olive|lime/.test(value)) return 'vertes';
  if (/blue|azure|cyan/.test(value)) return 'bleues';
  if (/brown|nougat/.test(value)) return 'brunes';
  if (/purple|lavender|violet/.test(value)) return 'violettes';
  if (/trans|clear/.test(value)) return 'transparentes';
  return value || 'couleur inconnue';
}

function splitColorLabel(colorName) {
  const value = normalizeSplitText(colorName);
  const translations = [[/^black$/, 'Noir'], [/^white$/, 'Blanc'], [/^red$/, 'Rouge'], [/^blue$/, 'Bleu'], [/^yellow$/, 'Jaune'], [/^green$/, 'Vert'], [/^orange$/, 'Orange'], [/^dark bluish gray$/, 'Gris foncé'], [/^light bluish gray$/, 'Gris clair'], [/^reddish brown$/, 'Brun'], [/^tan$/, 'Beige']];
  return translations.find(([pattern]) => pattern.test(value))?.[1] || String(colorName || 'Couleur inconnue');
}

function splitSizeProfile(physical) {
  const dimensions = physical?.dimensionsCm?.map(Number) || [];
  if (dimensions.length < 3 || !dimensions.every(value => Number.isFinite(value) && value > 0)) return null;
  const studs = [dimensions[0], dimensions[2]].map(value => Math.max(1, Math.round(value / 0.8))).sort((a, b) => a - b);
  const [shortSide, longSide] = studs;
  const area = shortSide * longSide;
  const label = `${shortSide}×${longSide}`;
  return {
    label,
    group2: area <= 4 && longSide <= 2 ? 'small' : 'large',
    group3: area <= 4 && longSide <= 2 ? 'small' : area <= 12 && longSide <= 4 ? 'medium' : 'large'
  };
}

function splitQuantity(items) {
  return items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
}

function splitCandidate(kind, criterion, groups, coherence, retrieval) {
  if (groups.some(group => !group.items.length)) return null;
  const total = groups.reduce((sum, group) => sum + splitQuantity(group.items), 0) || 1;
  const quantities = groups.map(group => splitQuantity(group.items));
  const balance = 100 - (Math.max(...quantities) - Math.min(...quantities)) / total * 100;
  return { kind, criterion, groups, coherence, retrieval, balance };
}

function splitFeatureCandidates(items, count) {
  const candidates = [];
  if (count === 2) {
    const definitions = [
      ['topOpening', 'ouverture sur le dessus', 'Avec une ouverture sur le dessus', 'Sans ouverture sur le dessus'],
      ['hole', 'présence d’un trou ou d’une ouverture', 'Avec un trou ou une ouverture', 'Sans trou ni ouverture détecté'],
      ['technic', 'usage LEGO Technic', 'Pièces LEGO Technic', 'Pièces LEGO System et accessoires'],
      ['figure', 'usage figurine ou animal', 'Parties d’animaux, de droïdes ou de figurines', 'Pièces de construction et accessoires'],
      ['grip', 'présence d’une prise', 'Avec clip, barre, poignée ou articulation', 'Sans clip, barre ni poignée']
    ];
    for (const [feature, criterion, yesLabel, noLabel] of definitions) {
      const groups = [{ label: yesLabel, items: items.filter(item => item._features[feature]) }, { label: noLabel, items: items.filter(item => !item._features[feature]) }];
      if (groups.some(group => !group.items.length)) continue;
      const maxFamilies = Math.max(...groups.map(group => new Set(group.items.map(item => item._family.key)).size));
      candidates.push(splitCandidate('feature', criterion, groups, Math.max(55, 99 - (maxFamilies - 1) * 6), 98));
    }
  } else {
    const groups = [
      { label: 'Ouverture sur le dessus', items: items.filter(item => item._features.topOpening) },
      { label: 'Autre trou ou connexion', items: items.filter(item => item._features.hole && !item._features.topOpening) },
      { label: 'Sans trou ni ouverture détecté', items: items.filter(item => !item._features.hole) }
    ];
    if (groups.every(group => group.items.length)) {
      const maxFamilies = Math.max(...groups.map(group => new Set(group.items.map(item => item._family.key)).size));
      candidates.push(splitCandidate('feature', 'position des trous et ouvertures', groups, Math.max(60, 100 - (maxFamilies - 1) * 5), 99));
    }
  }
  return candidates.filter(Boolean);
}

function splitColorCandidate(items, count) {
  const shapes = new Set(items.map(item => item._shape));
  const byColor = new Map();
  for (const item of items) {
    const key = String(item.colorName || item.colorId || 'Couleur inconnue');
    if (!byColor.has(key)) byColor.set(key, { name: key, bucket: item._color, items: [] });
    byColor.get(key).items.push(item);
  }
  if (shapes.size > 2 || byColor.size < count) return null;
  const entries = [...byColor.values()].sort((a, b) => a.bucket.localeCompare(b.bucket, 'fr') || splitQuantity(b.items) - splitQuantity(a.items));
  const groups = Array.from({ length: count }, () => ({ entries: [], items: [], buckets: new Set() }));
  for (const entry of entries) {
    const empty = groups.filter(group => !group.entries.length);
    const candidates = empty.length >= entries.length - groups.reduce((sum, group) => sum + group.entries.length, 0) ? empty : groups;
    const destination = [...candidates].sort((a, b) => Number(a.buckets.has(entry.bucket)) - Number(b.buckets.has(entry.bucket)) || a.entries.length - b.entries.length || splitQuantity(a.items) - splitQuantity(b.items))[0];
    destination.entries.push(entry);
    destination.items.push(...entry.items);
    destination.buckets.add(entry.bucket);
  }
  const repeatedBuckets = groups.reduce((sum, group) => sum + group.entries.length - group.buckets.size, 0);
  return splitCandidate('color', 'palettes de couleurs contrastées', groups.map(group => ({
    label: `Couleurs : ${group.entries.map(entry => splitColorLabel(entry.name)).join(', ')}`,
    items: group.items
  })), shapes.size === 1 ? 100 : 95, Math.max(70, 100 - repeatedBuckets * 7));
}

function splitSizeCandidate(items, count) {
  if (items.some(item => !item._size)) return null;
  const definitions = count === 2
    ? [['small', 'Gabarit jusqu’à 2×2'], ['large', 'Gabarit supérieur à 2×2']]
    : [['small', 'Gabarit jusqu’à 2×2'], ['medium', 'Gabarit moyen, de 2×3 à 3×4 environ'], ['large', 'Grand gabarit, au-delà de 3×4 environ']];
  const key = count === 2 ? 'group2' : 'group3';
  return splitCandidate('size', 'gabarit au sol en tenons', definitions.map(([value, label]) => ({ label, items: items.filter(item => item._size[key] === value) })), 94, 97);
}

function splitFamilyCandidate(items, count) {
  const byFamily = new Map();
  for (const item of items) {
    if (!byFamily.has(item._family.key)) byFamily.set(item._family.key, { ...item._family, items: [] });
    byFamily.get(item._family.key).items.push(item);
  }
  const entries = [...byFamily.values()];
  if (entries.length < count) return null;
  let best = null;
  const assignments = Array(entries.length).fill(0);
  function visit(index) {
    if (index === entries.length) {
      const bins = Array.from({ length: count }, () => []);
      entries.forEach((entry, entryIndex) => bins[assignments[entryIndex]].push(entry));
      if (bins.some(bin => !bin.length)) return;
      const maxFamilies = Math.max(...bins.map(bin => bin.length));
      const maxDomains = Math.max(...bins.map(bin => new Set(bin.map(entry => entry.domain)).size));
      const groups = bins.map(bin => ({ label: bin.map(entry => entry.label).join(' + '), items: bin.flatMap(entry => entry.items) }));
      const candidate = splitCandidate('family', 'familles visuelles ou d’utilisation', groups, Math.max(60, 104 - (maxFamilies - 1) * 5 - (maxDomains - 1) * 6), Math.max(65, 98 - (maxFamilies - 1) * 4));
      if (!best || compareSplitCandidates(candidate, best) < 0) best = candidate;
      return;
    }
    for (let group = 0; group < count; group += 1) {
      assignments[index] = group;
      visit(index + 1);
    }
  }
  assignments[0] = 0;
  visit(1);
  return best;
}

function splitFallbackCandidate(items, count) {
  const byShape = new Map();
  for (const item of items) {
    if (!byShape.has(item._shape)) byShape.set(item._shape, []);
    byShape.get(item._shape).push(item);
  }
  let blocks = [...byShape.entries()].map(([shape, shapeItems]) => ({ shape, items: shapeItems, quantity: splitQuantity(shapeItems) }));
  if (blocks.length < count) blocks = items.map(item => ({ shape: item.partNum, items: [item], quantity: splitQuantity([item]) }));
  blocks.sort((a, b) => b.quantity - a.quantity);
  const groups = Array.from({ length: count }, () => ({ blocks: [], items: [] }));
  blocks.forEach((block, index) => {
    const destination = index < count ? groups[index] : [...groups].sort((a, b) => splitQuantity(a.items) - splitQuantity(b.items))[0];
    destination.blocks.push(block);
    destination.items.push(...block.items);
  });
  return splitCandidate('shape', 'formes exactes', groups.map(group => ({ label: `Formes : ${group.blocks.map(block => block.shape).join(', ')}`, items: group.items })), 70, 75);
}

function compareSplitCandidates(a, b) {
  return b.coherence - a.coherence || b.retrieval - a.retrieval || b.balance - a.balance || a.kind.localeCompare(b.kind);
}

function splitCaseAdvice(items, groupCount, location = '', freeLocations = []) {
  const count = Number(groupCount);
  if (![2, 3].includes(count)) throw new Error('Choisissez une division en 2 ou en 3.');
  if (!Array.isArray(items) || items.length < count) throw new Error(`Cette case doit contenir au moins ${count} références pour être divisée en ${count}.`);
  const annotated = items.map(item => ({
    ...item,
    _shape: splitShapeKey(item.partNum),
    _family: splitFamily(item.name),
    _features: splitFeatures(item.name),
    _color: splitColorBucket(item.colorName),
    _size: splitSizeProfile(item.physical)
  }));
  const candidates = [
    splitColorCandidate(annotated, count),
    ...splitFeatureCandidates(annotated, count),
    splitFamilyCandidate(annotated, count),
    splitSizeCandidate(annotated, count),
    splitFallbackCandidate(annotated, count)
  ].filter(Boolean).sort(compareSplitCandidates);
  const selected = candidates[0];
  const totalQuantity = splitQuantity(annotated) || 1;
  const suggestedLocations = [String(location || ''), ...freeLocations.map(item => typeof item === 'string' ? item : item.location).filter(Boolean)];
  const cleanItem = item => {
    const { _shape, _family, _features, _color, _size, ...original } = item;
    return original;
  };
  return {
    location: String(location || ''),
    groupCount: count,
    criterion: selected.criterion,
    method: `Critère retenu : ${selected.criterion}. La cohérence nommable est prioritaire, puis la facilité de repérage ; l’équilibre du nombre de pièces arrive en dernier.`,
    scores: { coherence: Math.round(selected.coherence), retrieval: Math.round(selected.retrieval), balance: Math.round(selected.balance) },
    groups: selected.groups.map((group, index) => {
      const groupItems = group.items.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }) || String(a.colorName).localeCompare(String(b.colorName), 'fr'));
      const quantity = splitQuantity(groupItems);
      return {
        index: index + 1,
        label: group.label,
        suggestedLocation: suggestedLocations[index] || '',
        referenceCount: groupItems.length,
        quantity,
        estimatedSharePercent: Math.round(quantity / totalQuantity * 100),
        reasons: [
          `Cohérence : ${group.label}.`,
          selected.kind === 'color' ? 'Les couleurs proches sont séparées autant que possible pour faciliter la recherche.' : `Repérage fondé sur ${selected.criterion}.`,
          `${Math.round(quantity / totalQuantity * 100)} % des pièces ; cet équilibre n’a été utilisé qu’après les deux critères précédents.`
        ],
        items: groupItems.map(cleanItem)
      };
    })
  };
}

let colorImageCache;
const colorImageRequests = new Map();

async function partColorImage(partNum, colorId) {
  const part = String(partNum || '').trim();
  const color = Number(colorId);
  if (!/^[a-z0-9_-]{1,80}$/i.test(part) || !Number.isInteger(color)) throw new Error('Référence de pièce invalide.');
  colorImageCache ||= readJson(COLOR_IMAGES_PATH, { images: {} });
  colorImageCache.images ||= {};
  const key = `${part}|${color}`;
  if (colorImageCache.images[key]) return colorImageCache.images[key];
  if (colorImageRequests.has(key)) return colorImageRequests.get(key);
  const pending = (async () => {
    const local = savedConfig();
    if (!local.apiKey) throw new Error('Clé API Rebrickable absente.');
    const detail = await requestJson(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${color}/`, local.apiKey);
    const imageUrl = detail.part_img_url || detail.elements?.find(element => element.part_img_url)?.part_img_url || '';
    if (!/^https:\/\//.test(imageUrl)) throw new Error('Image couleur indisponible.');
    colorImageCache.images[key] = imageUrl;
    fs.writeFileSync(COLOR_IMAGES_PATH, `${JSON.stringify(colorImageCache, null, 2)}\n`, 'utf8');
    return imageUrl;
  })();
  colorImageRequests.set(key, pending);
  try { return await pending; }
  finally { colorImageRequests.delete(key); }
}

function consolidateMoveHistory(existingMoves, movedItems, metadataItems = []) {
  const metadata = new Map(metadataItems.map(item => [mappingIdentity(item), item]));
  const historyMap = new Map();
  for (const entry of existingMoves || []) {
    const key = mappingIdentity(entry);
    const previous = historyMap.get(key);
    historyMap.set(key, {
      ...previous, ...entry, id: previous?.id || entry.id || randomUUID(),
      originalLocation: previous?.originalLocation || entry.originalLocation || entry.fromLocation,
      currentLocation: entry.currentLocation || entry.toLocation
    });
  }
  for (const item of movedItems || []) {
    const key = mappingIdentity(item);
    const detail = metadata.get(key) || {};
    const previous = historyMap.get(key);
    const entry = {
      id: previous?.id || randomUUID(), movedAt: previous?.movedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      partNum: item.partNum, colorId: item.colorId,
      colorName: String(detail.colorName || item.colorName || '').slice(0, 100), name: String(detail.name || item.partNum).slice(0, 200),
      imageUrl: /^(?:https:\/\/|\/api\/storage\/image\?)/.test(String(detail.imageUrl || '')) ? String(detail.imageUrl) : '', quantity: item.quantity ?? detail.quantity ?? null,
      originalLocation: previous?.originalLocation || item.fromLocation, currentLocation: item.toLocation
    };
    if (entry.originalLocation.toLocaleLowerCase('fr') === entry.currentLocation.toLocaleLowerCase('fr')) historyMap.delete(key);
    else historyMap.set(key, entry);
  }
  return [...historyMap.values()];
}

function moveStorage(input) {
  const current = readJson(LOCATIONS_PATH, { mappings: [] });
  const result = moveStorageMappings(current.mappings || [], input);
  fs.writeFileSync(LOCATIONS_PATH, `${JSON.stringify({ ...current, modifiedAt: new Date().toISOString(), mappings: result.mappings }, null, 2)}\n`, 'utf8');

  const overrides = readJson(LOCATION_OVERRIDES_PATH, { mappings: [] }).mappings || [];
  const overrideMap = new Map(overrides.map(item => [mappingIdentity(item), item]));
  const history = readJson(MOVE_HISTORY_PATH, { moves: [] });
  history.moves = consolidateMoveHistory(history.moves || [], result.moved, input.items || []);
  const changed = new Set(history.moves.map(mappingIdentity));
  result.moved.forEach(item => {
    const key = mappingIdentity(item);
    if (changed.has(key)) overrideMap.set(key, { partNum: item.partNum, colorId: item.colorId, colorName: item.colorName || '', location: item.toLocation });
    else overrideMap.delete(key);
  });
  fs.writeFileSync(MOVE_HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LOCATION_OVERRIDES_PATH, `${JSON.stringify({ mappings: [...overrideMap.values()] }, null, 2)}\n`, 'utf8');
  return { movedCount: result.moved.length, sourceEmpty: result.sourceEmpty, historyCount: history.moves.length };
}

function revertMoveHistory() {
  const history = readJson(MOVE_HISTORY_PATH, { moves: [] });
  const moves = consolidateMoveHistory(history.moves || [], []);
  if (!moves.length) return { moves: [], revertedCount: 0 };
  const originals = new Map(moves.map(item => [mappingIdentity(item), item.originalLocation || item.fromLocation]));
  const current = readJson(LOCATIONS_PATH, { mappings: [] });
  current.mappings = (current.mappings || []).map(mapping => originals.has(mappingIdentity(mapping)) ? { ...mapping, location: originals.get(mappingIdentity(mapping)) } : mapping);
  fs.writeFileSync(LOCATIONS_PATH, `${JSON.stringify({ ...current, modifiedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');

  const overrides = readJson(LOCATION_OVERRIDES_PATH, { mappings: [] }).mappings || [];
  fs.writeFileSync(LOCATION_OVERRIDES_PATH, `${JSON.stringify({ mappings: overrides.filter(item => !originals.has(mappingIdentity(item))) }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MOVE_HISTORY_PATH, `${JSON.stringify({ moves: [] }, null, 2)}\n`, 'utf8');
  return { moves: [], revertedCount: moves.length };
}

function progressSetKey(setNum, inventory) {
  return `${String(setNum || '').trim()}|${inventory == null ? 'current' : Number(inventory)}`;
}

function progressFor(setNum, inventory) {
  const progress = readJson(PROGRESS_PATH, { sets: {} });
  return progress.sets?.[progressSetKey(setNum, inventory)] || { completed: [] };
}

function completedWithChange(values, partKey, completed) {
  const result = new Set(values || []);
  completed ? result.add(partKey) : result.delete(partKey);
  return [...result].sort();
}

function updateProgress(input) {
  const setNum = cleanModel(input.setNum).id;
  const inventory = input.inventory == null || input.inventory === '' ? null : Number(input.inventory);
  if (inventory != null && (!Number.isInteger(inventory) || inventory < 0)) throw new Error('Version d’inventaire invalide.');
  const partKeys = (Array.isArray(input.partKeys) ? input.partKeys : [input.partKey]).map(value => String(value || '').trim());
  if (!partKeys.length || partKeys.some(partKey => !partKey || partKey.length > 200 || !partKey.includes('|'))) throw new Error('Référence de pièce invalide.');
  const progress = readJson(PROGRESS_PATH, { sets: {} });
  progress.sets ||= {};
  const key = progressSetKey(setNum, inventory);
  let completed = progress.sets[key]?.completed || [];
  partKeys.forEach(partKey => { completed = completedWithChange(completed, partKey, Boolean(input.completed)); });
  progress.sets[key] = { updatedAt: new Date().toISOString(), completed };
  fs.writeFileSync(PROGRESS_PATH, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  return progress.sets[key];
}

function unzip(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Archive ZIP invalide.');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const files = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + filenameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    if (!name.endsWith('/') && compressedSize < 25_000_000) {
      const content = compression === 0 ? compressed : compression === 8 ? zlib.inflateRawSync(compressed) : null;
      if (content) files.push({ name, content });
    }
    cursor += 46 + filenameLength + extraLength + commentLength;
  }
  return files;
}

function mappingsFromJson(data) {
  const mappings = [];
  const aliases = {
    part: ['part', 'partnum', 'partnumber', 'partid', 'designid', 'ldrawid'],
    colorId: ['colorid', 'colourid', 'rbcolorid', 'rebrickablecolorid'],
    colorName: ['colorname', 'colourname', 'couleur'],
    location: ['location', 'storage', 'storagelocation', 'emplacement', 'case', 'bin', 'drawer']
  };
  const direct = (object, names) => {
    for (const [key, value] of Object.entries(object || {})) if (names.includes(normalized(key)) && ['string', 'number'].includes(typeof value)) return value;
    return undefined;
  };
  const walk = (value, inherited = {}, depth = 0) => {
    if (depth > 12 || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(item => walk(item, inherited, depth + 1));
    const nestedPart = value.part && typeof value.part === 'object' ? direct(value.part, aliases.part) : undefined;
    const nestedColorId = value.color && typeof value.color === 'object' ? direct(value.color, aliases.colorId) ?? direct(value.color, ['id']) : undefined;
    const nestedColorName = value.color && typeof value.color === 'object' ? direct(value.color, ['name', ...aliases.colorName]) : undefined;
    const context = {
      partNum: direct(value, aliases.part) ?? nestedPart ?? inherited.partNum,
      colorId: direct(value, aliases.colorId) ?? nestedColorId ?? inherited.colorId,
      colorName: direct(value, aliases.colorName) ?? nestedColorName ?? inherited.colorName,
      location: direct(value, aliases.location) ?? inherited.location
    };
    if (context.partNum != null && context.location != null && String(context.location).trim()) {
      mappings.push({
        partNum: String(context.partNum).trim(),
        colorId: context.colorId != null && /^-?\d+$/.test(String(context.colorId)) ? Number(context.colorId) : null,
        colorName: String(context.colorName || '').trim(),
        location: String(context.location).trim()
      });
    }
    Object.values(value).forEach(child => walk(child, context, depth + 1));
  };
  walk(data);
  return mappings;
}

function importBackup(filename, base64) {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw new Error('Le fichier est vide.');
  const entries = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50 ? unzip(buffer) : [{ name: filename || 'backup', content: buffer }];
  const mappings = [];
  entries.forEach(entry => {
    const extension = path.extname(entry.name).toLowerCase();
    const text = entry.content.toString('utf8');
    try {
      if (extension === '.json' || /^[\s\r\n]*[\[{]/.test(text)) mappings.push(...mappingsFromJson(JSON.parse(text)));
      else if (['.csv', '.tsv', '.txt'].includes(extension)) mappings.push(...mappingsFromCsv(text));
    } catch {}
  });
  const unique = new Map();
  mappings.forEach(mapping => unique.set(`${mapping.partNum}|${mapping.colorId ?? mapping.colorName}|${mapping.location}`, mapping));
  const cleaned = applyLocationOverrides([...unique.values()]);
  if (!cleaned.length) throw new Error('Aucun champ Location associé à une pièce n’a été trouvé dans cette sauvegarde.');
  fs.writeFileSync(LOCATIONS_PATH, `${JSON.stringify({ importedAt: new Date().toISOString(), source: filename, mappings: cleaned }, null, 2)}\n`, 'utf8');
  return cleaned.length;
}

function addImportedLocations(parts) {
  const mappings = readJson(LOCATIONS_PATH).mappings || [];
  const byId = new Map(mappings.filter(m => m.colorId != null).map(m => [`${m.partNum}|${m.colorId}`, m.location]));
  const byName = new Map(mappings.filter(m => m.colorName).map(m => [`${m.partNum}|${m.colorName.toLowerCase()}`, m.location]));
  const locationsByPart = new Map();
  mappings.forEach(mapping => locationsByPart.set(mapping.partNum, new Set([...(locationsByPart.get(mapping.partNum) || []), mapping.location])));
  const byPart = new Map([...locationsByPart].filter(([, locations]) => locations.size === 1).map(([partNum, locations]) => [partNum, [...locations][0]]));
  return parts.map(part => ({
    ...part,
    location: byId.get(`${part.part?.part_num}|${part.color?.id}`) || byName.get(`${part.part?.part_num}|${String(part.color?.name || '').toLowerCase()}`) || byPart.get(part.part?.part_num) || ''
  }));
}

function cleanSetNumber(value) {
  const match = String(value || '').match(/(?:sets\/)?([a-z0-9]+-\d+)/i);
  if (!match) throw new Error('Lien ou numéro de set invalide (exemple : 21309-1).');
  return match[1];
}

async function mocPartsFromCache(cached, base, apiKey) {
  const partNums = [...new Set(cached.parts.map(item => item.partNum))];
  const details = [];
  for (let offset = 0; offset < partNums.length; offset += 100) {
    const query = encodeURIComponent(partNums.slice(offset, offset + 100).join(','));
    details.push(...await getAll(`${base}/lego/parts/?part_nums=${query}&page_size=1000&inc_part_details=1`, apiKey));
  }
  const colors = await getAll(`${base}/lego/colors/?page_size=500`, apiKey);
  const byPart = new Map(details.map(part => [String(part.part_num), part]));
  const byColor = new Map(colors.map(color => [Number(color.id), color]));
  return cached.parts.map(item => ({
    part: byPart.get(item.partNum) || { part_num: item.partNum, name: item.partNum },
    color: byColor.get(Number(item.colorId)) || { id: Number(item.colorId), name: `Couleur ${item.colorId}` },
    quantity: item.quantity,
    is_spare: false
  }));
}

async function api(req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw || '{}');
  const local = savedConfig();
  const apiKey = input.apiKey || process.env.REBRICKABLE_API_KEY || local.apiKey;
  const userToken = input.userToken && input.userToken !== '__saved__' ? input.userToken : local.userToken;
  if (!apiKey) return send(res, 400, { error: 'Ajoutez votre clé API Rebrickable.' });
  if (!userToken) return send(res, 400, { error: 'Ajoutez votre jeton utilisateur Rebrickable.' });

  try {
    const model = cleanModel(input.setUrl);
    const setNum = model.id;
    const base = 'https://rebrickable.com/api/v3';
    const inventory = model.type === 'set' ? inventoryFromUrl(input.setUrl) : null;
    let set, setParts;
    if (model.type === 'moc') {
      const cached = readJson(SET_INVENTORIES_PATH).models?.[setNum];
      if (!cached) return send(res, 409, { error: `Le MOC ${setNum} n’est pas encore synchronisé. Rechargez l’extension Chrome puis relancez la recherche depuis le PC.` });
      set = { set_num: setNum, name: cached.name || setNum, set_img_url: cached.imageUrl || '' };
      setParts = await mocPartsFromCache(cached, base, apiKey);
    } else {
      set = await requestJson(`${base}/lego/sets/${encodeURIComponent(setNum)}/`, apiKey);
      const catalogParts = withoutSpares(await getAll(`${base}/lego/sets/${encodeURIComponent(setNum)}/parts/?page_size=500&inc_spares=0&inc_minifig_parts=1&inc_part_details=1`, apiKey));
      setParts = catalogParts;
      if (inventory != null) {
        const cached = readJson(SET_INVENTORIES_PATH).inventories?.[`${setNum}|${inventory}`];
        if (!cached) return send(res, 409, { error: `La version d’inventaire ${inventory} n’est pas encore synchronisée par l’extension.` });
        const details = new Map(catalogParts.map(part => [`${part.part?.part_num}|${part.color?.id}`, part]));
        setParts = cached.parts.map(item => {
          const detail = details.get(`${item.partNum}|${item.colorId}`);
          return detail ? { ...detail, quantity: item.quantity, is_spare: false } : { part: { part_num: item.partNum, name: item.partNum }, color: { id: item.colorId, name: `Couleur ${item.colorId}` }, quantity: item.quantity, is_spare: false };
        });
      }
    }
    setParts = withoutSpares(setParts);
    const physicalData = enrichWithPhysicalData(setParts);
    setParts = withoutSpares(physicalData.parts);
    const locationImport = readJson(LOCATIONS_PATH);
    const importedMappings = locationImport.mappings || [];
    let storedParts;
    if (importedMappings.length) {
      storedParts = importedMappings.map(mapping => ({
        part: { part_num: mapping.partNum },
        color: { id: mapping.colorId, name: mapping.colorName },
        location: mapping.location
      }));
    } else {
      const partListId = Number(input.partListId || local.partListId || 108467);
      storedParts = addImportedLocations(await getAll(`${base}/users/${encodeURIComponent(userToken)}/partlists/${partListId}/parts/?page_size=500`, apiKey));
    }
    send(res, 200, { set, modelType: model.type, setParts, storedParts, inventory, progress: progressFor(setNum, inventory), physicalData: physicalData.status, locationImport: { count: locationImport.mappings?.length || 0, importedAt: locationImport.importedAt || null } });
  } catch (error) {
    send(res, error.status || 500, { error: error.message || 'Erreur inattendue.' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/login') {
    if (!isLoopback(req)) return send(res, 403, { error: 'Configurez la connexion Rebrickable depuis le PC.' });
    return login(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/login/saved') return savedLogin(res);
  if (req.method === 'POST' && req.url === '/api/locations/import') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const count = importLocations(JSON.parse(raw || '{}').content || '');
      return send(res, 200, { count });
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/locations/import-json') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const count = importLocationMappings(JSON.parse(raw || '{}').mappings);
      return send(res, 200, { count });
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/locations/import-backup') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw || '{}');
      const count = importBackup(input.filename, input.base64);
      return send(res, 200, { count });
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/set-inventory/import') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw || '{}');
      return send(res, 200, importSetInventory(input.sourceUrl, input.content || ''));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/model-inventory/import') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw || '{}');
      return send(res, 200, importModelInventory(input.sourceUrl, input.content || '', input.metadata));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/locations/assign') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      return send(res, 200, assignLocation(JSON.parse(raw || '{}')));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && req.url === '/api/storage/cases') {
    const mappings = readJson(LOCATIONS_PATH, { mappings: [] }).mappings || [];
    return send(res, 200, { occupied: occupiedCases(mappings), empty: inferredEmptyCases(mappings) });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/storage/case?')) {
    try {
      const location = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams.get('location');
      return send(res, 200, await storageCase(location));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/storage/advice?')) {
    try {
      const query = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
      const data = await storageCase(query.get('location'));
      const mappings = readJson(LOCATIONS_PATH, { mappings: [] }).mappings || [];
      return send(res, 200, splitCaseAdvice(data.items, Number(query.get('groups')), data.location, inferredEmptyCases(mappings)));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/storage/image?')) {
    try {
      const query = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
      const imageUrl = await partColorImage(query.get('partNum'), query.get('colorId'));
      res.writeHead(302, { location: imageUrl, 'cache-control': 'public, max-age=604800' });
      return res.end();
    } catch { return send(res, 404, { error: 'Image couleur indisponible.' }); }
  }
  if (req.method === 'POST' && req.url === '/api/storage/move') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      return send(res, 200, moveStorage(JSON.parse(raw || '{}')));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && req.url === '/api/storage/history') {
    const history = readJson(MOVE_HISTORY_PATH, { moves: [] });
    return send(res, 200, { moves: consolidateMoveHistory(history.moves || [], []) });
  }
  if (req.method === 'POST' && req.url === '/api/storage/history/clear') {
    return send(res, 200, revertMoveHistory());
  }
  if (req.method === 'POST' && req.url === '/api/progress') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      return send(res, 200, updateProgress(JSON.parse(raw || '{}')));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/locations') return api(req, res);
  if (req.method === 'GET' && req.url === '/api/config-status') {
    const local = savedConfig();
    const locations = readJson(LOCATIONS_PATH);
    return send(res, 200, { configured: Boolean(local.apiKey && (local.userToken || local.password)), username: isLoopback(req) ? local.username || '' : '', partListId: local.partListId || 108467, locationCount: locations.mappings?.length || 0, local: isLoopback(req) });
  }
  if (req.method === 'GET' && req.url === '/api/network-info') {
    return send(res, 200, { urls: networkUrls(), port: PORT, local: isLoopback(req) });
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Méthode non autorisée' });
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.resolve(PUBLIC, `.${requested}`);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Accès interdit' });
  fs.readFile(file, (err, content) => err ? send(res, 404, { error: 'Introuvable' }) : send(res, 200, content, types[path.extname(file)] || 'application/octet-stream'));
});

if (require.main === module) server.listen(PORT, HOST, () => {
  console.log(`LEGO Rangement (PC) : http://localhost:${PORT}`);
  networkUrls().forEach(url => console.log(`LEGO Rangement (téléphone, même Wi-Fi) : ${url}`));
});
module.exports = { cleanSetNumber, cleanModel, inventoryFromUrl, mappingsFromCsv, setPartsFromCsv, withoutSpares, combineLDrawBounds, physicalFromLDrawBounds, upsertLocationMapping, occupiedCases, storageCaseUniverse, inferredEmptyCases, moveStorageMappings, consolidateMoveHistory, splitCaseAdvice, completedWithChange, networkUrls, server };
