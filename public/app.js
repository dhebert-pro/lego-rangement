const form = document.querySelector('#form');
const state = document.querySelector('#state');
const results = document.querySelector('#results');
const groups = document.querySelector('#groups');
let rows = [], filter = 'all', userToken = '';
let usingSavedConfig = false;
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
  const locations = new Map();
  storedParts.forEach(p => {
    const key = keyOf(p), note = locationOf(p);
    if (note) locations.set(key, [...(locations.get(key) || []), note]);
  });
  return setParts.map(p => ({ ...p, location: [...new Set(locations.get(keyOf(p)) || [])].join(', ') }));
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function render() {
  const term = document.querySelector('#search').value.toLowerCase();
  const visible = rows.filter(r => (filter !== 'missing' || !r.location) && [r.part?.part_num, r.part?.name, r.color?.name, r.location].join(' ').toLowerCase().includes(term));
  const buckets = visible.reduce((map, row) => {
    const key = row.location || 'Sans case';
    map.set(key, [...(map.get(key) || []), row]);
    return map;
  }, new Map());
  groups.innerHTML = [...buckets].sort(([a], [b]) => a === 'Sans case' ? 1 : b === 'Sans case' ? -1 : a.localeCompare(b, 'fr', { numeric: true })).map(([location, parts]) => `
    <article class="group ${location === 'Sans case' ? 'missing' : ''}"><div class="case"><small>CASE</small><strong>${escapeHtml(location)}</strong><span>${parts.length} référence${parts.length > 1 ? 's' : ''}</span></div><div class="parts">${parts.map(p => `
      <div class="part"><div class="pic">${p.part?.part_img_url ? `<img src="${escapeHtml(p.part.part_img_url)}" alt="">` : '◫'}</div><div><b>${escapeHtml(p.part?.name)}</b><span>${escapeHtml(p.color?.name)} · ${escapeHtml(p.part?.part_num)}</span></div><strong class="qty">× ${p.quantity}</strong></div>`).join('')}</div></article>`).join('') || '<p class="no-result">Aucune pièce ne correspond.</p>';
}

form.addEventListener('submit', async event => {
  event.preventDefault(); results.hidden = true; state.hidden = false; state.className = 'loading'; state.innerHTML = '<div class="spinner"></div><h2>Inventaire en cours…</h2><p>Comparaison du set avec votre part list. Une grande liste peut prendre quelques secondes.</p>';
  try {
    if (!userToken) throw new Error('Connectez-vous d’abord à Rebrickable.');
    let requestedInventory = null;
    try { requestedInventory = new URL(setUrl.value).searchParams.get('inventory'); } catch {}
    if (requestedInventory) {
      state.querySelector('p').textContent = `Synchronisation de l’inventaire ${requestedInventory} demandé…`;
      try { await syncViaExtension('set', setUrl.value); } catch {}
    }
    const response = await fetch('/api/locations', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ setUrl: setUrl.value, apiKey: apiKey.value, userToken, partListId: partListId.value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    rows = mergeParts(data.setParts, data.storedParts);
    const located = rows.filter(r => r.location).length;
    setName.textContent = `${data.set.set_num} · ${data.set.name}${data.inventory != null ? ` · inventaire ${data.inventory}` : ''}`;
    stats.innerHTML = `<strong>${located}/${rows.length}</strong><span>références localisées</span>`;
    const notice = document.querySelector('#locationNotice');
    notice.hidden = located > 0 || data.locationImport?.count > 0;
    notice.innerHTML = notice.hidden ? '' : '<strong>Pourquoi aucune case ?</strong> Rebrickable affiche les emplacements sur son site mais ne les renvoie pas dans son API. Importez l’export CSV de la part list avec le bouton ci-dessus.';
    state.hidden = true; results.hidden = false; render();
  } catch (error) { state.className = 'error'; state.innerHTML = `<div class="bin-icon">!</div><h2>Impossible de charger les pièces</h2><p>${escapeHtml(error.message)}</p>`; }
});
document.querySelector('#login').addEventListener('click', async () => {
  const button = document.querySelector('#login');
  const status = document.querySelector('#loginStatus');
  button.disabled = true;
  status.className = 'working';
  status.textContent = 'Connexion en cours…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.value, username: username.value, password: password.value })
    });
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
  } finally {
    button.disabled = false;
  }
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
    if (config.locationCount) {
      document.querySelector('#importStatus').textContent = `${config.locationCount} emplacements déjà enregistrés.`;
    }
    if (!config.configured) { status.textContent = 'Connexion nécessaire avant la recherche.'; return; }
    const response = await fetch('/api/login/saved', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    userToken = data.userToken;
    usingSavedConfig = true;
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
    const response = await fetch('/api/locations/import-backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, base64: btoa(binary) })
    });
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
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active')); button.classList.add('active'); filter = button.dataset.filter; render(); }));
window.mergeParts = mergeParts;
autoLogin();
