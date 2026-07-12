const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.local.json');
const LOCATIONS_PATH = path.join(__dirname, 'locations.local.json');
const SET_INVENTORIES_PATH = path.join(__dirname, 'set-inventories.local.json');
const BRICKLINK_CACHE_PATH = path.join(__dirname, 'bricklink-cache.local.json');

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
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

function savedBrickLinkConfig() {
  return readJson(CONFIG_PATH).bricklink || {};
}

function saveBrickLinkConfig(bricklink) {
  const config = readJson(CONFIG_PATH);
  config.bricklink = bricklink;
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

const oauthEncode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

async function requestBrickLinkItem(partNum, credentials = savedBrickLinkConfig()) {
  const required = ['consumerKey', 'consumerSecret', 'token', 'tokenSecret'];
  if (!required.every(key => credentials[key])) throw Object.assign(new Error('Connexion BrickLink non configurée.'), { code: 'BRICKLINK_NOT_CONFIGURED' });
  const url = `https://api.bricklink.com/api/store/v1/items/PART/${encodeURIComponent(partNum)}`;
  const oauth = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_token: credentials.token,
    oauth_version: '1.0'
  };
  const parameterString = Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${oauthEncode(key)}=${oauthEncode(value)}`).join('&');
  const signatureBase = `GET&${oauthEncode(url)}&${oauthEncode(parameterString)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', `${oauthEncode(credentials.consumerSecret)}&${oauthEncode(credentials.tokenSecret)}`).update(signatureBase).digest('base64');
  const authorization = `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`).join(', ')}`;
  const response = await fetch(url, { headers: { Authorization: authorization } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.meta?.code >= 400) {
    const status = body.meta?.code || response.status;
    throw Object.assign(new Error(body.meta?.message || `Erreur BrickLink (${status})`), { status });
  }
  return body.data || {};
}

function physicalFromBrickLink(item, bricklinkNo) {
  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const dimensionsCm = [number(item.dim_x), number(item.dim_y), number(item.dim_z)];
  const completeDimensions = dimensionsCm.every(value => value != null);
  return {
    source: 'BrickLink',
    bricklinkNo: String(bricklinkNo || item.no || ''),
    weightG: number(item.weight),
    dimensionsCm,
    volumeCm3: completeDimensions ? Number(dimensionsCm.reduce((product, value) => product * value, 1).toFixed(3)) : null
  };
}

function brickLinkNumber(part) {
  const external = part?.part?.external_ids?.BrickLink ?? part?.external_ids?.BrickLink;
  const candidate = Array.isArray(external) ? external[0] : external;
  return candidate == null || String(candidate).trim() === '' ? null : String(candidate).trim();
}

async function enrichWithBrickLink(parts) {
  const credentials = savedBrickLinkConfig();
  if (!['consumerKey', 'consumerSecret', 'token', 'tokenSecret'].every(key => credentials[key])) {
    return { parts, status: { configured: false, available: 0, total: parts.length } };
  }
  const cache = readJson(BRICKLINK_CACHE_PATH, { items: {} });
  cache.items ||= {};
  const unique = [...new Set(parts.map(brickLinkNumber).filter(Boolean))];
  let cursor = 0;
  let lastError = '';
  let authenticationFailed = false;
  const worker = async () => {
    while (cursor < unique.length && !authenticationFailed) {
      const partNum = unique[cursor++];
      const cached = cache.items[partNum];
      const cacheDuration = cached?.physical ? 90 * 24 * 60 * 60 * 1000 : 5 * 60 * 1000;
      const fresh = cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < cacheDuration;
      if (fresh) continue;
      try {
        const item = await requestBrickLinkItem(partNum, credentials);
        cache.items[partNum] = { fetchedAt: new Date().toISOString(), physical: physicalFromBrickLink(item, partNum) };
      } catch (error) {
        lastError = error.message;
        if ([401, 403].includes(error.status)) authenticationFailed = true;
        cache.items[partNum] = { fetchedAt: new Date().toISOString(), physical: null, error: error.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
  fs.writeFileSync(BRICKLINK_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  const enriched = parts.map(part => {
    const number = brickLinkNumber(part);
    return { ...part, physical: number ? cache.items[number]?.physical || null : null, bricklinkNo: number };
  });
  return {
    parts: enriched,
    status: { configured: true, available: enriched.filter(part => part.physical?.weightG || part.physical?.dimensionsCm?.some(Boolean)).length, total: enriched.length, error: lastError }
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
    send(res, 200, { userToken: local.userToken, username: local.username, partListId: local.partListId || 108467 });
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

function importLocations(content) {
  const mappings = mappingsFromCsv(content);
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

function importLocationMappings(input) {
  const mappings = (Array.isArray(input) ? input : []).map(item => ({
    partNum: String(item.partNum || '').trim(),
    colorId: Number.isInteger(Number(item.colorId)) && String(item.colorId).trim() !== '' ? Number(item.colorId) : null,
    colorName: String(item.colorName || '').trim(),
    location: String(item.location || '').trim()
  })).filter(item => item.partNum && item.location);
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
  const cleaned = [...unique.values()];
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

async function api(req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw || '{}');
  const local = savedConfig();
  const apiKey = input.apiKey || process.env.REBRICKABLE_API_KEY || local.apiKey;
  const userToken = input.userToken || local.userToken;
  if (!apiKey) return send(res, 400, { error: 'Ajoutez votre clé API Rebrickable.' });
  if (!userToken) return send(res, 400, { error: 'Ajoutez votre jeton utilisateur Rebrickable.' });

  try {
    const setNum = cleanSetNumber(input.setUrl);
    const base = 'https://rebrickable.com/api/v3';
    const set = await requestJson(`${base}/lego/sets/${encodeURIComponent(setNum)}/`, apiKey);
    const catalogParts = await getAll(`${base}/lego/sets/${encodeURIComponent(setNum)}/parts/?page_size=500&inc_spares=0&inc_minifig_parts=1&inc_part_details=1`, apiKey);
    const inventory = inventoryFromUrl(input.setUrl);
    let setParts = catalogParts;
    if (inventory != null) {
      const cached = readJson(SET_INVENTORIES_PATH).inventories?.[`${setNum}|${inventory}`];
      if (!cached) return send(res, 409, { error: `La version d’inventaire ${inventory} n’est pas encore synchronisée par l’extension.` });
      const details = new Map(catalogParts.map(part => [`${part.part?.part_num}|${part.color?.id}`, part]));
      setParts = cached.parts.map(item => {
        const detail = details.get(`${item.partNum}|${item.colorId}`);
        return detail ? { ...detail, quantity: item.quantity, is_spare: false } : { part: { part_num: item.partNum, name: item.partNum }, color: { id: item.colorId, name: `Couleur ${item.colorId}` }, quantity: item.quantity, is_spare: false };
      });
    }
    const physicalData = await enrichWithBrickLink(setParts);
    setParts = physicalData.parts;
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
    send(res, 200, { set, setParts, storedParts, inventory, physicalData: physicalData.status, locationImport: { count: locationImport.mappings?.length || 0, importedAt: locationImport.importedAt || null } });
  } catch (error) {
    send(res, error.status || 500, { error: error.message || 'Erreur inattendue.' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/login') return login(req, res);
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
  if (req.method === 'POST' && req.url === '/api/locations/assign') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      return send(res, 200, assignLocation(JSON.parse(raw || '{}')));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/bricklink/config') {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw || '{}');
      const bricklink = Object.fromEntries(['consumerKey', 'consumerSecret', 'token', 'tokenSecret'].map(key => [key, String(input[key] || '').trim()]));
      if (Object.values(bricklink).some(value => !value)) throw new Error('Les quatre identifiants API BrickLink sont nécessaires.');
      saveBrickLinkConfig(bricklink);
      const cache = readJson(BRICKLINK_CACHE_PATH, { items: {} });
      cache.items = Object.fromEntries(Object.entries(cache.items || {}).filter(([, item]) => item.physical));
      fs.writeFileSync(BRICKLINK_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
      return send(res, 200, { configured: true });
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/locations') return api(req, res);
  if (req.method === 'GET' && req.url === '/api/config-status') {
    const local = savedConfig();
    const bricklink = savedBrickLinkConfig();
    const locations = readJson(LOCATIONS_PATH);
    return send(res, 200, { configured: Boolean(local.apiKey && (local.userToken || local.password)), username: local.username || '', partListId: local.partListId || 108467, locationCount: locations.mappings?.length || 0, bricklinkConfigured: ['consumerKey', 'consumerSecret', 'token', 'tokenSecret'].every(key => bricklink[key]) });
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Méthode non autorisée' });
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.resolve(PUBLIC, `.${requested}`);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Accès interdit' });
  fs.readFile(file, (err, content) => err ? send(res, 404, { error: 'Introuvable' }) : send(res, 200, content, types[path.extname(file)] || 'application/octet-stream'));
});

if (require.main === module) server.listen(PORT, () => console.log(`LEGO Rangement : http://localhost:${PORT}`));
module.exports = { cleanSetNumber, inventoryFromUrl, mappingsFromCsv, setPartsFromCsv, physicalFromBrickLink, upsertLocationMapping, server };
