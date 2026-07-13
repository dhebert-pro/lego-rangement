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
let currentSetNum = '', currentInventory = null, panelsInitialized = false;
let extensionVersion = '';
const expandedPanels = new Set();
const isLocalBrowser = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const pendingExtensionSync = new Map();

window.addEventListener('message', event => {
  const message = event.data;
  if (event.source !== window || message?.source !== 'LEGO_RANGEMENT_EXTENSION') return;
  if (message.type === 'READY') {
    extensionVersion = message.version || '';
    const status = document.querySelector('#importStatus');
    status.className = 'connected';
    status.textContent = `Extension ${extensionVersion || ''} active · synchronisation automatique, sans relance entre deux modèles.`;
    return;
  }
  if (message.type !== 'SYNC_RESULT') return;
  const pending = pendingExtensionSync.get(message.requestId);
  if (!pending) return;
  pendingExtensionSync.delete(message.requestId);
  message.result?.ok ? pending.resolve(message.result) : pending.reject(new Error(message.result?.error || 'Synchronisation Chrome impossible.'));
});

function syncViaExtension(mode, url) {
  if (!isLocalBrowser) return Promise.reject(new Error('La synchronisation Chrome se lance uniquement depuis le PC.'));
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

function coordinationHtml(part) {
  const indicator = part.coordination || {};
  if (indicator.both) return `<span class="coordination coordination-both">Forme complète (${indicator.colorCount} couleurs) + couleur complète (${indicator.shapeCount} formes) à cette étape</span>`;
  const badges = [];
  if (indicator.shapeComplete) badges.push(`<span class="coordination coordination-shape">Toutes les couleurs de cette forme (${indicator.colorCount}) à cette étape</span>`);
  if (indicator.colorComplete) badges.push(`<span class="coordination coordination-color">Toutes les formes de cette couleur (${indicator.shapeCount}) à cette étape</span>`);
  return badges.join('');
}

function partHtml(part, missing = false) {
  const sorting = part.sorting || LegoPlanner.pieceDifficulty(part);
  return `<div class="part ${missing ? 'unassigned' : ''} ${part.completed ? 'completed' : ''}">
    <div class="part-visual"><label class="done-control"><input type="checkbox" data-toggle-complete data-row-key="${escapeHtml(keyOf(part))}" ${part.completed ? 'checked' : ''}><span aria-hidden="true">✓</span><small>Rangé</small></label><div class="pic">${part.part?.part_img_url ? `<img src="${escapeHtml(part.part.part_img_url)}" data-preview alt="Agrandir ${escapeHtml(part.part?.name || part.part?.part_num)}">` : '◫'}</div></div>
    <div class="part-info"><b>${escapeHtml(part.part?.name || part.part?.part_num)}</b><span>${escapeHtml(part.color?.name)} · ${escapeHtml(part.part?.part_num)}${part.bricklinkUrl ? ` · <a href="${escapeHtml(part.bricklinkUrl)}" target="_blank" rel="noreferrer">fiche BrickLink</a>` : ''}</span><span class="physical-data">${escapeHtml(physicalLabel(part))}</span><span class="difficulty difficulty-${sorting.level.toLowerCase()}">${sorting.level} · ${escapeHtml(sorting.reasons.join(', '))}</span>${coordinationHtml(part)}${editorHtml(part, missing)}</div>
    <strong class="qty">× ${part.quantity}</strong>
  </div>`;
}

function matchesSearch(part, term) {
  return [part.part?.part_num, part.part?.name, part.color?.name, part.location].join(' ').toLowerCase().includes(term);
}

const panelKeyOf = visit => `${visit.location}|${visit.visitIndex}`;

function panelHtml({ key, caseClass = '', eyebrow, title, subtitle, extra = '', content, expanded }) {
  return `<article class="group ${caseClass} ${expanded ? 'expanded' : 'collapsed'}" data-panel-key="${escapeHtml(key)}"><button type="button" class="case" data-toggle-panel data-panel-key="${escapeHtml(key)}" aria-expanded="${expanded}"><small>${eyebrow}</small><strong>${escapeHtml(title)}</strong><span>${subtitle}</span>${extra}<i class="panel-chevron" aria-hidden="true">⌄</i></button><div class="parts" ${expanded ? '' : 'hidden'}>${content}</div></article>`;
}

function caseProgressHtml(visit) {
  const location = visit.location;
  const caseRows = rows.filter(part => part.location === location);
  const done = caseRows.filter(part => part.completed).length;
  const stepKeys = [...new Set(visit.parts.map(keyOf))];
  return `<div class="case-progress"><span><b>${done}/${caseRows.length}</b> références rangées dans cette case</span><button type="button" data-complete-step="${escapeHtml(encodeURIComponent(JSON.stringify(stepKeys)))}">Ranger cette étape (${stepKeys.length})</button></div>`;
}

function completedPanels(term) {
  const completed = rows.filter(part => part.completed && matchesSearch(part, term));
  if (!completed.length) return '<p class="no-result">Aucune pièce rangée pour le moment.</p>';
  const byCase = new Map();
  completed.forEach(part => {
    const location = part.location || 'Sans case';
    byCase.set(location, [...(byCase.get(location) || []), part]);
  });
  return [...byCase].sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true })).map(([location, parts]) => {
    const allCaseRows = rows.filter(part => (part.location || 'Sans case') === location);
    const complete = allCaseRows.length === parts.length && allCaseRows.every(part => part.completed);
    const key = `done|${location}`;
    return panelHtml({ key, caseClass: `completed-group ${complete ? 'case-complete' : ''}`, eyebrow: complete ? 'CASE TERMINÉE ✓' : 'DÉJÀ RANGÉES', title: location, subtitle: `${parts.length}/${allCaseRows.length} références · cliquez sur une coche pour corriger`, content: parts.map(part => partHtml(part, !part.location)).join(''), expanded: expandedPanels.has(key) });
  }).join('');
}

function render() {
  const term = document.querySelector('#search').value.toLowerCase();
  if (filter === 'completed') {
    groups.innerHTML = completedPanels(term);
    return;
  }
  const remainingRows = rows.filter(part => !part.completed);
  const plan = LegoPlanner.buildStoragePlan(remainingRows);
  if (!panelsInitialized) {
    const firstIncomplete = plan.visits.find(visit => visit.parts.some(part => !part.completed)) || plan.visits[0];
    if (firstIncomplete) expandedPanels.add(panelKeyOf(firstIncomplete));
    panelsInitialized = true;
  }
  if (filter === 'missing') {
    const missing = plan.missing.filter(part => matchesSearch(part, term));
    groups.innerHTML = missing.length ? panelHtml({ key: 'missing', caseClass: 'missing', eyebrow: 'À CLASSER', title: 'Sans case', subtitle: `${missing.length} référence${missing.length > 1 ? 's' : ''}`, content: missing.map(part => partHtml(part, true)).join(''), expanded: expandedPanels.has('missing') }) : '<p class="no-result">Toutes les pièces ont une case.</p>';
    return;
  }
  const visits = plan.visits.map(visit => ({ ...visit, visibleParts: visit.parts.filter(part => matchesSearch(part, term)) })).filter(visit => visit.visibleParts.length).map(visit => {
    const key = panelKeyOf(visit);
    const extra = visit.split ? `<em>Passage ${visit.visitIndex}/${visit.visitCount}</em>` : '';
    const note = visit.split ? `<p class="split-note">Cette case est ouverte en ${visit.visitCount} passages : ${escapeHtml(visit.splitReason)}.</p>` : '';
    const difficultyClass = visit.score < 36 ? 'easy-group' : visit.score < 61 ? 'medium-group' : 'hard-group';
    return panelHtml({ key, caseClass: `planned-group ${difficultyClass}`, eyebrow: `ÉTAPE ${visit.step}`, title: visit.location, subtitle: visit.score < 36 ? 'Recherche facile' : visit.score < 61 ? 'Recherche intermédiaire' : 'Recherche minutieuse', extra, content: caseProgressHtml(visit) + note + visit.visibleParts.map(part => partHtml(part)).join(''), expanded: expandedPanels.has(key) });
  }).join('');
  const visibleMissing = plan.missing.filter(part => matchesSearch(part, term));
  const missing = visibleMissing.length ? panelHtml({ key: 'missing', caseClass: 'missing', eyebrow: 'À ATTRIBUER', title: 'Sans case', subtitle: `${visibleMissing.length} référence${visibleMissing.length > 1 ? 's' : ''}`, content: visibleMissing.map(part => partHtml(part, true)).join(''), expanded: expandedPanels.has('missing') }) : '';
  groups.innerHTML = visits + missing || '<p class="no-result">Aucune pièce ne correspond.</p>';
}

function updateStats() {
  const located = rows.filter(part => part.location).length;
  const totalPieces = rows.reduce((total, part) => total + (Number(part.quantity) || 0), 0);
  const completedPieces = rows.filter(part => part.completed).reduce((total, part) => total + (Number(part.quantity) || 0), 0);
  const rawPercent = totalPieces ? completedPieces * 100 / totalPieces : 0;
  const percent = rawPercent > 0 && rawPercent < 10 ? Number(rawPercent.toFixed(1)) : Math.round(rawPercent);
  stats.innerHTML = `<div class="location-stat"><strong>${located}/${rows.length}</strong><span>références localisées</span></div><div class="progress-stat"><div><strong>${percent}%</strong><span>${completedPieces}/${totalPieces} pièces rangées</span></div><progress value="${completedPieces}" max="${Math.max(totalPieces, 1)}" aria-label="Progression du rangement">${percent}%</progress></div>`;
  const completedCount = rows.filter(part => part.completed).length;
  document.querySelector('#completedFilter').textContent = `Rangées (${completedCount})`;
  document.querySelector('#resetProgress').hidden = completedCount === 0;
}

async function persistProgress(partKeys, completed) {
  const response = await fetch('/api/progress', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setNum: currentSetNum, inventory: currentInventory, partKeys, completed })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
}

groups.addEventListener('click', async event => {
  const completeStepButton = event.target.closest('[data-complete-step]');
  if (completeStepButton) {
    const affected = JSON.parse(decodeURIComponent(completeStepButton.dataset.completeStep));
    if (!affected.length) return;
    const affectedSet = new Set(affected);
    const previous = rows;
    rows = rows.map(part => affectedSet.has(keyOf(part)) ? { ...part, completed: true } : part);
    updateStats(); render();
    try { await persistProgress(affected, true); }
    catch (error) { rows = previous; updateStats(); render(); window.alert(`Progression non enregistrée : ${error.message}`); }
    return;
  }
  const panelButton = event.target.closest('[data-toggle-panel]');
  if (panelButton) {
    const key = panelButton.dataset.panelKey;
    expandedPanels.has(key) ? expandedPanels.delete(key) : expandedPanels.add(key);
    render();
    return;
  }
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
    expandedPanels.add(`${location}|1`);
    updateStats();
    render();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'save-status failed';
    button.disabled = false;
  }
});

document.querySelector('#resetProgress').addEventListener('click', async () => {
  const affected = [...new Set(rows.filter(part => part.completed).map(keyOf))];
  if (!affected.length || !window.confirm(`Décocher les ${affected.length} références rangées de ce modèle ?`)) return;
  const previous = rows;
  rows = rows.map(part => ({ ...part, completed: false }));
  filter = 'all';
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === 'all'));
  expandedPanels.clear(); panelsInitialized = false;
  updateStats(); render();
  try { await persistProgress(affected, false); }
  catch (error) { rows = previous; updateStats(); render(); window.alert(`Progression non enregistrée : ${error.message}`); }
});

groups.addEventListener('change', async event => {
  const checkbox = event.target.closest('[data-toggle-complete]');
  if (!checkbox) return;
  const partKey = checkbox.dataset.rowKey;
  const completed = checkbox.checked;
  const previous = rows;
  rows = rows.map(part => keyOf(part) === partKey ? { ...part, completed } : part);
  updateStats();
  render();
  try {
    await persistProgress([partKey], completed);
  } catch (error) {
    rows = previous;
    updateStats();
    render();
    window.alert(`Progression non enregistrée : ${error.message}`);
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
    let requestedInventory = null, modelMode = 'set';
    try { const requestedUrl = new URL(setUrl.value); requestedInventory = requestedUrl.searchParams.get('inventory'); modelMode = requestedUrl.pathname.startsWith('/mocs/') ? 'moc' : 'set'; } catch {}
    const requestLocations = async () => {
      const response = await fetch('/api/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setUrl: setUrl.value, apiKey: apiKey.value, userToken, partListId: partListId.value }) });
      return { response, data: await response.json() };
    };
    let { response, data } = await requestLocations();
    if (response.status === 409 && (requestedInventory || modelMode === 'moc')) {
      state.querySelector('p').textContent = modelMode === 'moc' ? 'Premier chargement du MOC : export automatique en arrière-plan…' : `Premier chargement de l’inventaire ${requestedInventory}…`;
      try {
        await syncViaExtension(modelMode, setUrl.value);
      } catch (syncError) {
        throw new Error(`${data.error} L’extension n’a pas répondu (${syncError.message}). Sur le PC, actualisez-la une fois depuis chrome://extensions.`);
      }
      ({ response, data } = await requestLocations());
    }
    if (!response.ok) throw new Error(data.error);
    currentSetNum = data.set.set_num;
    currentInventory = data.inventory;
    const completed = new Set(data.progress?.completed || []);
    rows = mergeParts(data.setParts.filter(part => !part.is_spare && !part.isSpare), data.storedParts).map(part => ({ ...part, completed: completed.has(keyOf(part)) }));
    expandedPanels.clear();
    panelsInitialized = false;
    setName.textContent = `${data.set.set_num} · ${data.set.name}${data.inventory != null ? ` · inventaire ${data.inventory}` : ''}`;
    const modelImage = document.querySelector('#modelImage');
    modelImage.hidden = !data.set.set_img_url;
    modelImage.src = data.set.set_img_url || '';
    modelImage.alt = data.set.set_img_url ? `Image de ${data.set.name}` : '';
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
    userToken = '__saved__';
    username.value = data.username || config.username || '';
    [apiKey, username, password].forEach(input => { input.disabled = true; input.required = false; });
    document.querySelector('#login').hidden = true;
    status.className = 'connected';
    status.textContent = data.username || config.username ? `Connecté automatiquement en tant que ${data.username || config.username}.` : 'Connecté avec la configuration enregistrée sur le PC.';
    document.querySelector('#connection').open = false;
    const importStatus = document.querySelector('#importStatus');
    importStatus.textContent = 'Synchronisation automatique de la part list…';
    if (config.local) {
      syncViaExtension('locations', 'https://rebrickable.com/users/sourivore/partlists/108467/')
        .then(result => { importStatus.className = 'connected'; importStatus.textContent = `${result.count} emplacements synchronisés automatiquement.`; })
        .catch(error => { importStatus.textContent = config.locationCount ? `${config.locationCount} emplacements locaux disponibles.` : error.message; });
    } else {
      document.querySelector('#connection').hidden = true;
      importStatus.textContent = `${config.locationCount || 0} emplacements fournis par le PC.`;
    }
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
document.querySelector('#expandAll').addEventListener('click', () => {
  groups.querySelectorAll('[data-toggle-panel]').forEach(button => expandedPanels.add(button.dataset.panelKey));
  render();
});
document.querySelector('#collapseAll').addEventListener('click', () => {
  expandedPanels.clear();
  panelsInitialized = true;
  render();
});

async function loadNetworkInfo() {
  try {
    const response = await fetch('/api/network-info');
    const info = await response.json();
    const panel = document.querySelector('#networkAccess');
    const address = info.local ? info.urls?.[0] : location.origin;
    if (!address) return;
    panel.hidden = false;
    const link = document.querySelector('#networkUrl');
    link.href = address;
    link.textContent = address;
    if (!info.local) {
      document.querySelector('#networkTitle').textContent = 'Connecté au PC';
      panel.querySelector('span').textContent = 'Cette application fonctionne dans le navigateur du téléphone, sans installation.';
    }
  } catch {}
}

document.querySelector('#copyNetworkUrl').addEventListener('click', async event => {
  const value = document.querySelector('#networkUrl').href;
  try {
    await navigator.clipboard.writeText(value);
    event.currentTarget.textContent = 'Adresse copiée';
  } catch {
    window.prompt('Copiez cette adresse :', value);
  }
});
window.mergeParts = mergeParts;
autoLogin();
loadNetworkInfo();
