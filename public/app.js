const form = document.querySelector('#form');
const state = document.querySelector('#state');
const results = document.querySelector('#results');
const groups = document.querySelector('#groups');
const setUrl = document.querySelector('#setUrl');
const apiKey = document.querySelector('#apiKey');
const username = document.querySelector('#username');
const password = document.querySelector('#password');
const partListId = document.querySelector('#partListId');
const setName = document.querySelector('#setName');
const stats = document.querySelector('#stats');
let rows = [], filter = 'all', userToken = '';
const pendingExtensionSync = new Map();

window.addEventListener('message', event => {
  const message = event.data;
  if (event.source !== window || message?.source !== 'LEGO_RANGEMENT_EXTENSION' || message?.type !== 'SYNC_RESULT') return;
  const pending = pendingExtensionSync.get(message.requestId);
  if (!pending) return;
  pendingExtensionSync.delete(message.requestId);
  message.result?.ok ? pending.resolve(message.result) : pending.reject(new Error(message.result?.error || 'Synchronisation Chrome impossible.'));
});

function syncViaExtension(mode, url) {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    pendingExtensionSync.set(requestId, { resolve, reject });
    const request = { source: 'LEGO_RANGEMENT_APP', type: 'SYNC', requestId, mode, url };
    [0, 500, 1200].forEach(delay => setTimeout(() => { if (pendingExtensionSync.has(requestId)) window.postMessage(request, location.origin); }, delay));
    setTimeout(() => {
      if (!pendingExtensionSync.has(requestId)) return;
      pendingExtensionSync.delete(requestId);
      reject(new Error('Module Chrome absent ou sans réponse.'));
    }, 45000);
  });
}

const keyOf = item => `${item.part?.part_num || ''}|${item.color?.id ?? ''}`;
const locationOf = item => String(item.note ?? item.remarks ?? item.location ?? '').trim();

function mergeParts(setParts, storedParts) {
  const exact = new Map();
  const byPartLocations = new Map();
  storedParts.forEach(part => {
    const partNum = String(part.part?.part_num || '');
    const note = locationOf(part);
    if (!partNum || !note) return;
    if (part.color?.id != null) exact.set(keyOf(part), note);
    byPartLocations.set(partNum, new Set([...(byPartLocations.get(partNum) || []), note]));
  });
  const byPart = new Map([...byPartLocations].filter(([, locations]) => locations.size === 1).map(([partNum, locations]) => [partNum, [...locations][0]]));
  return setParts.map(part => ({ ...part, location: exact.get(keyOf(part)) || byPart.get(String(part.part?.part_num || '')) || '' }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function physicalLabel(part) {
  const physical = part.physical;
  if (!physical) return 'Géométrie LDraw indisponible';
  const dimensions = (physical.dimensionsCm || []).map(value => Number(value) || 0);
  const weight = physical.weightG ? ` · ${Number(physical.weightG).toFixed(2)} g` : '';
  return dimensions.every(Boolean) ? `${dimensions.map(value => value.toFixed(2)).join(' × ')} cm${weight} · ${physical.source}` : 'Géométrie LDraw incomplète';
}

function editorHtml(part, alwaysOpen = false) {
  const key = keyOf(part);
  return `<details class="case-editor"${alwaysOpen ? ' open' : ''}><summary>${alwaysOpen ? 'Attribuer une case' : 'Changer de case'}</summary><div><input data-location-input value="${escapeHtml(part.location)}" placeholder="Ex. C2" aria-label="Numéro de case"><button type="button" data-save-location data-row-key="${escapeHtml(key)}">Enregistrer</button></div><span class="save-status" aria-live="polite"></span></details>`;
}

function partHtml(part, missing = false) {
  const sorting = part.sorting || LegoPlanner.pieceDifficulty(part);
  return `<div class="part ${missing ? 'unassigned' : ''}">
    <div class="pic">${part.part?.part_img_url ? `<img src="${escapeHtml(part.part.part_img_url)}" alt="">` : '◫'}</div>
    <div class="part-info"><b>${escapeHtml(part.part?.name || part.part?.part_num)}</b><span>${escapeHtml(part.color?.name)} · ${escapeHtml(part.part?.part_num)}${part.bricklinkUrl ? ` · <a href="${escapeHtml(part.bricklinkUrl)}" target="_blank" rel="noreferrer">fiche BrickLink</a>` : ''}</span><span class="physical-data">${escapeHtml(physicalLabel(part))}</span><span class="difficulty difficulty-${sorting.level.toLowerCase()}">${sorting.level} · ${escapeHtml(sorting.reasons.join(', '))}</span>${editorHtml(part, missing)}</div>
    <strong class="qty">× ${part.quantity}</strong>
  </div>`;
}

function matchesSearch(part, term) {
  return [part.part?.part_num, part.part?.name, part.color?.name, part.location].join(' ').toLowerCase().includes(term);
}

function render() {
  const term = document.querySelector('#search').value.toLowerCase();
  const visibleRows = rows.filter(part => matchesSearch(part, term));
  const plan = LegoPlanner.buildStoragePlan(visibleRows);
  if (filter === 'missing') {
    groups.innerHTML = plan.missing.length ? `<article class="group missing"><div class="case"><small>À CLASSER</small><strong>Sans case</strong><span>${plan.missing.length} référence${plan.missing.length > 1 ? 's' : ''}</span></div><div class="parts">${plan.missing.map(part => partHtml(part, true)).join('')}</div></article>` : '<p class="no-result">Toutes les pièces ont une case.</p>';
    return;
  }
  const visits = plan.visits.map(visit => `<article class="group planned-group" data-score="${visit.score}"><div class="case"><small>ÉTAPE ${visit.step}</small><strong>${escapeHtml(visit.location)}</strong><span>${visit.score < 36 ? 'Recherche facile' : visit.score < 61 ? 'Recherche intermédiaire' : 'Recherche minutieuse'}</span>${visit.split ? `<em>Passage ${visit.visitIndex}/${visit.visitCount}</em>` : ''}</div><div class="parts">${visit.split ? `<p class="split-note">Cette case est ouverte en ${visit.visitCount} passages : ${escapeHtml(visit.splitReason)}.</p>` : ''}${visit.parts.map(part => partHtml(part)).join('')}</div></article>`).join('');
  const missing = plan.missing.length ? `<article class="group missing"><div class="case"><small>À ATTRIBUER</small><strong>Sans case</strong><span>${plan.missing.length} référence${plan.missing.length > 1 ? 's' : ''}</span></div><div class="parts">${plan.missing.map(part => partHtml(part, true)).join('')}</div></article>` : '';
  groups.innerHTML = visits + missing || '<p class="no-result">Aucune pièce ne correspond.</p>';
}

function updateStats() {
  const located = rows.filter(part => part.location).length;
  stats.innerHTML = `<strong>${located}/${rows.length}</strong><span>références localisées</span>`;
}

groups.addEventListener('click', async event => {
  const button = event.target.closest('[data-save-location]');
  if (!button) return;
  const editor = button.closest('.case-editor');
  const input = editor.querySelector('[data-location-input]');
  const status = editor.querySelector('.save-status');
  const row = rows.find(part => keyOf(part) === button.dataset.rowKey);
  if (!row) return;
  const location = input.value.trim();
  if (!location) { status.textContent = 'Indiquez une case.'; status.className = 'save-status failed'; return; }
  button.disabled = true;
  status.textContent = 'Enregistrement…';
  status.className = 'save-status';
  try {
    const response = await fetch('/api/locations/assign', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partNum: row.part?.part_num, colorId: row.color?.id, colorName: row.color?.name, location })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    rows = rows.map(part => keyOf(part) === keyOf(row) ? { ...part, location } : part);
    updateStats();
    render();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'save-status failed';
    button.disabled = false;
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  results.hidden = true;
  state.hidden = false;
  state.className = 'loading';
    state.innerHTML = '<div class="spinner"></div><h2>Inventaire en cours…</h2><p>Comparaison du set et calcul des encombrements LDraw mis en cache.</p>';
  try {
    if (!userToken) throw new Error('Connectez-vous d’abord à Rebrickable.');
    let requestedInventory = null;
    try { requestedInventory = new URL(setUrl.value).searchParams.get('inventory'); } catch {}
    if (requestedInventory) {
      state.querySelector('p').textContent = `Synchronisation de l’inventaire ${requestedInventory} demandé…`;
      try { await syncViaExtension('set', setUrl.value); } catch {}
    }
    const response = await fetch('/api/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setUrl: setUrl.value, apiKey: apiKey.value, userToken, partListId: partListId.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    rows = mergeParts(data.setParts, data.storedParts);
    setName.textContent = `${data.set.set_num} · ${data.set.name}${data.inventory != null ? ` · inventaire ${data.inventory}` : ''}`;
    updateStats();
    const locationNotice = document.querySelector('#locationNotice');
    const located = rows.filter(part => part.location).length;
    locationNotice.hidden = located > 0 || data.locationImport?.count > 0;
    locationNotice.innerHTML = locationNotice.hidden ? '' : '<strong>Pourquoi aucune case ?</strong> Importez l’export CSV de la part list ou attribuez les cases directement ci-dessous.';
    const physicalNotice = document.querySelector('#physicalNotice');
    const physical = data.physicalData || {};
    physicalNotice.hidden = physical.available === physical.total && !physical.error;
    physicalNotice.innerHTML = `<strong>Couverture géométrique : ${physical.available || 0}/${physical.total || rows.length}.</strong> Poids Studio disponibles pour ${physical.weights || 0} références. Certaines références peuvent ne pas posséder de modèle 3D officiel ; aucun nom de pièce n’est utilisé pour estimer leur taille.`;
    state.hidden = true;
    results.hidden = false;
    render();
  } catch (error) {
    state.className = 'error';
    state.innerHTML = `<div class="bin-icon">!</div><h2>Impossible de charger les pièces</h2><p>${escapeHtml(error.message)}</p>`;
  }
});

document.querySelector('#login').addEventListener('click', async () => {
  const button = document.querySelector('#login');
  const status = document.querySelector('#loginStatus');
  button.disabled = true;
  status.className = 'working';
  status.textContent = 'Connexion en cours…';
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: apiKey.value, username: username.value, password: password.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    userToken = data.userToken;
    password.value = '';
    password.required = false;
    status.className = 'connected';
    status.textContent = `Connecté en tant que ${username.value}.`;
    button.textContent = 'Reconnecter';
  } catch (error) {
    userToken = '';
    status.className = 'failed';
    status.textContent = error.message;
  } finally { button.disabled = false; }
});

['apiKey', 'username'].forEach(id => document.querySelector(`#${id}`).addEventListener('input', () => {
  userToken = '';
  password.required = true;
  const status = document.querySelector('#loginStatus');
  status.className = '';
  status.textContent = 'Identifiants modifiés : reconnectez-vous.';
}));

async function autoLogin() {
  const status = document.querySelector('#loginStatus');
  try {
    const configResponse = await fetch('/api/config-status');
    const config = await configResponse.json();
    partListId.value = config.partListId || 108467;
    if (config.locationCount) document.querySelector('#importStatus').textContent = `${config.locationCount} emplacements déjà enregistrés.`;
    if (!config.configured) { status.textContent = 'Connexion nécessaire avant la recherche.'; return; }
    const response = await fetch('/api/login/saved', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    userToken = data.userToken;
    username.value = data.username || config.username || '';
    [apiKey, username, password].forEach(input => { input.disabled = true; input.required = false; });
    document.querySelector('#login').hidden = true;
    status.className = 'connected';
    status.textContent = `Connecté automatiquement en tant que ${data.username || config.username}.`;
    document.querySelector('#connection').open = false;
    const importStatus = document.querySelector('#importStatus');
    importStatus.textContent = 'Synchronisation automatique de la part list…';
    syncViaExtension('locations', 'https://rebrickable.com/users/sourivore/partlists/108467/')
      .then(result => { importStatus.className = 'connected'; importStatus.textContent = `${result.count} emplacements synchronisés automatiquement.`; })
      .catch(error => { importStatus.textContent = config.locationCount ? `${config.locationCount} emplacements locaux disponibles.` : error.message; });
  } catch (error) {
    status.className = 'failed';
    status.textContent = error.message;
  }
}

document.querySelector('#backupFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.querySelector('#importStatus');
  status.className = '';
  status.textContent = 'Analyse de la sauvegarde…';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const response = await fetch('/api/locations/import-backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, base64: btoa(binary) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    status.className = 'connected';
    status.textContent = `${data.count} emplacements enregistrés. Vous pouvez rechercher un set.`;
    if (!results.hidden) form.requestSubmit();
  } catch (error) {
    status.className = 'failed';
    status.textContent = error.message;
  } finally { event.target.value = ''; }
});

document.querySelector('#search').addEventListener('input', render);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach(candidate => candidate.classList.remove('active'));
  button.classList.add('active');
  filter = button.dataset.filter;
  render();
}));
window.mergeParts = mergeParts;
autoLogin();
