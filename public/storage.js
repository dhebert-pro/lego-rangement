const caseForm = document.querySelector('#caseForm');
const caseLocation = document.querySelector('#caseLocation');
const caseItems = document.querySelector('#caseItems');
const caseStatus = document.querySelector('#caseStatus');
const caseActions = document.querySelector('#caseActions');
const adviceActions = document.querySelector('#adviceActions');
const splitAdvice = document.querySelector('#splitAdvice');
const moveForm = document.querySelector('#moveForm');
const targetLocation = document.querySelector('#targetLocation');
const selectAllParts = document.querySelector('#selectAllParts');
let occupiedCases = [];
let emptyCases = [];
let currentCase = '';
let currentItems = [];
let currentAdvice = null;
let extensionReady = false;
const pendingExtensionSync = new Map();

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Opération impossible.');
  return data;
}

window.addEventListener('message', event => {
  const message = event.data;
  if (event.source !== window || message?.source !== 'LEGO_RANGEMENT_EXTENSION') return;
  if (message.type === 'READY') {
    extensionReady = true;
    document.querySelector('#resyncLocations').disabled = false;
    return;
  }
  if (message.type !== 'SYNC_RESULT') return;
  const pending = pendingExtensionSync.get(message.requestId);
  if (!pending) return;
  pendingExtensionSync.delete(message.requestId);
  message.result?.ok ? pending.resolve(message.result) : pending.reject(new Error(message.result?.error || 'Synchronisation Chrome impossible.'));
});

function syncLocationsViaExtension() {
  if (!extensionReady) return Promise.reject(new Error('Ouvrez cette page depuis Chrome avec le module LEGO Rangement actif.'));
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    pendingExtensionSync.set(requestId, { resolve, reject });
    const message = { source: 'LEGO_RANGEMENT_APP', type: 'SYNC', requestId, mode: 'locations', url: 'https://rebrickable.com/users/sourivore/partlists/108467/' };
    window.postMessage(message, location.origin);
    setTimeout(() => {
      if (!pendingExtensionSync.has(requestId)) return;
      pendingExtensionSync.delete(requestId);
      reject(new Error('Le module Chrome n’a pas répondu.'));
    }, 45000);
  });
}

function updateSelection() {
  const selected = [...document.querySelectorAll('[data-part-index]:checked')];
  const plural = selected.length === 1 ? '' : 's';
  document.querySelector('#selectionCount').textContent = `${selected.length} pièce${plural} sélectionnée${plural}`;
  document.querySelector('#moveSummary').textContent = `${selected.length} référence${plural} depuis la case ${currentCase}`;
  moveForm.hidden = selected.length === 0;
  selectAllParts.checked = Boolean(currentItems.length) && selected.length === currentItems.length;
  selectAllParts.indeterminate = selected.length > 0 && selected.length < currentItems.length;
}

function renderCaseItems() {
  caseItems.innerHTML = currentItems.length ? currentItems.map((item, index) => `<label class="storage-part">
    <span class="part-select"><input type="checkbox" data-part-index="${index}" aria-label="Sélectionner ${escapeHtml(item.name)} en ${escapeHtml(item.colorName)}"></span>
    <span class="storage-thumb">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" data-preview alt="Agrandir ${escapeHtml(item.name)}">` : '◫'}</span>
    <span class="storage-part-info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.colorName || 'Couleur inconnue')} · ${escapeHtml(item.partNum)}</span>${item.bricklinkUrl ? `<span><a href="${escapeHtml(item.bricklinkUrl)}" target="_blank" rel="noreferrer">Fiche BrickLink</a></span>` : ''}</span>
    <b class="storage-quantity">${item.quantity == null ? 'Qté ?' : `× ${item.quantity}`}</b>
  </label>`).join('') : '<p class="empty-message">Cette case ne contient aucune pièce connue.</p>';
  caseActions.hidden = !currentItems.length;
  adviceActions.hidden = currentItems.length < 2;
  adviceActions.querySelector('[data-advice-groups="3"]').disabled = currentItems.length < 3;
  moveForm.hidden = true;
  selectAllParts.checked = false;
  selectAllParts.indeterminate = false;
  updateSelection();
}

async function loadCase(location) {
  const requested = String(location || '').trim();
  if (!requested) return;
  caseStatus.textContent = 'Chargement des pièces et de leurs images…';
  caseItems.innerHTML = '';
  splitAdvice.innerHTML = '';
  currentAdvice = null;
  adviceActions.hidden = true;
  caseActions.hidden = true;
  moveForm.hidden = true;
  try {
    const data = await request(`/api/storage/case?location=${encodeURIComponent(requested)}`);
    currentCase = data.location;
    currentItems = data.items || [];
    caseLocation.value = currentCase;
    const quantity = currentItems.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
    caseStatus.textContent = `${currentItems.length} référence${currentItems.length === 1 ? '' : 's'}${quantity ? ` · ${quantity} pièce${quantity === 1 ? '' : 's'} au total` : ''}.`;
    renderCaseItems();
  } catch (error) {
    currentCase = requested;
    currentItems = [];
    caseStatus.textContent = error.message;
    renderCaseItems();
  }
}

function renderSplitAdvice(data) {
  currentAdvice = data;
  splitAdvice.innerHTML = `<div class="advice-heading"><div><p class="eyebrow">CONSEIL DE RÉPARTITION</p><h3>Scinder la case ${escapeHtml(data.location)} en ${data.groupCount}</h3></div><p>${escapeHtml(data.method)}</p></div>
    <div class="advice-groups" style="--advice-columns:${data.groupCount}">${data.groups.map(group => `<article class="advice-group">
      <header><span>Groupe ${group.index}</span><strong>${group.suggestedLocation ? `Case ${escapeHtml(group.suggestedLocation)}` : 'Case libre à choisir'}</strong></header>
      <h4>${escapeHtml(group.label)}</h4>
      <div class="advice-metrics"><b>${group.referenceCount} réf.</b><b>${group.quantity} pièces</b><b>${group.estimatedSharePercent}% des pièces</b></div>
      <ul>${group.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
      <div class="advice-move"><label>Case destination<input data-advice-target="${group.index}" list="allCases" value="${escapeHtml(group.suggestedLocation)}" autocomplete="off"></label><button type="button" data-move-advice-group="${group.index}">Déplacer ce groupe</button></div>
      <div class="advice-parts">${group.items.map(item => `<div class="advice-part">
        <span class="advice-thumb">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" data-preview alt="Agrandir ${escapeHtml(item.name)}">` : '◫'}</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.colorName || 'Couleur inconnue')} · ${escapeHtml(item.partNum)}</small></span>
        <b>${item.quantity == null ? 'Qté ?' : `× ${item.quantity}`}</b>
      </div>`).join('')}</div>
    </article>`).join('')}</div><div class="apply-advice"><button type="button" data-apply-advice>Appliquer tout le découpage</button><span>Les déplacements seront ajoutés à l’historique.</span></div>`;
}

adviceActions.addEventListener('click', async event => {
  const button = event.target.closest('[data-advice-groups]');
  if (!button || button.disabled) return;
  const groups = Number(button.dataset.adviceGroups);
  adviceActions.querySelectorAll('button').forEach(item => { item.disabled = true; });
  splitAdvice.innerHTML = '<p class="advice-loading">Analyse des formes, dimensions, couleurs et quantités…</p>';
  try {
    renderSplitAdvice(await request(`/api/storage/advice?location=${encodeURIComponent(currentCase)}&groups=${groups}`));
    splitAdvice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    splitAdvice.innerHTML = `<p class="advice-error">${escapeHtml(error.message)}</p>`;
  } finally {
    adviceActions.querySelector('[data-advice-groups="2"]').disabled = currentItems.length < 2;
    adviceActions.querySelector('[data-advice-groups="3"]').disabled = currentItems.length < 3;
  }
});

splitAdvice.addEventListener('click', async event => {
  const groupButton = event.target.closest('[data-move-advice-group]');
  const allButton = event.target.closest('[data-apply-advice]');
  if ((!groupButton && !allButton) || !currentAdvice) return;
  const controls = [...splitAdvice.querySelectorAll('[data-advice-target]')];
  const groups = currentAdvice.groups.map(group => ({
    ...group,
    toLocation: controls.find(input => Number(input.dataset.adviceTarget) === group.index)?.value.trim() || ''
  }));
  const button = groupButton || allButton;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Déplacement…';
  try {
    let result;
    if (groupButton) {
      const group = groups.find(item => item.index === Number(groupButton.dataset.moveAdviceGroup));
      if (!group?.toLocation) throw new Error('Indiquez une case de destination.');
      if (group.toLocation.toLocaleLowerCase('fr') === currentCase.toLocaleLowerCase('fr')) throw new Error('Choisissez une autre case pour déplacer ce groupe.');
      result = await request('/api/storage/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromLocation: currentCase, toLocation: group.toLocation, items: group.items }) });
    } else {
      result = await request('/api/storage/split', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromLocation: currentCase, groups: groups.map(group => ({ toLocation: group.toLocation, items: group.items })) }) });
    }
    const source = currentCase;
    await Promise.all([loadCases(), loadHistory()]);
    await loadCase(source);
    caseStatus.textContent = `${result.movedCount} référence${result.movedCount === 1 ? '' : 's'} déplacée${result.movedCount === 1 ? '' : 's'} depuis le découpage. Historique conservé.`;
  } catch (error) {
    caseStatus.textContent = error.message;
    button.disabled = false;
    button.textContent = originalText;
  }
});

function renderCaseLists() {
  document.querySelector('#occupiedCount').textContent = `${occupiedCases.length} cases occupées`;
  document.querySelector('#occupiedCases').innerHTML = occupiedCases.map(item => `<option value="${escapeHtml(item.location)}">${item.referenceCount} références</option>`).join('');
  document.querySelector('#allCases').innerHTML = [...occupiedCases.map(item => item.location), ...emptyCases.map(item => item.location)]
    .filter((value, index, values) => values.indexOf(value) === index).map(location => `<option value="${escapeHtml(location)}"></option>`).join('');
  document.querySelector('#emptyCount').textContent = emptyCases.length;
  document.querySelector('#emptyCasesList').innerHTML = emptyCases.length ? emptyCases.map(item => `<span class="empty-case">${escapeHtml(item.location)}</span>`).join('') : '<p class="empty-message">Aucune case libre détectée.</p>';
}

async function loadCases() {
  const data = await request('/api/storage/cases');
  occupiedCases = data.occupied || [];
  emptyCases = data.empty || [];
  renderCaseLists();
}

function renderHistory(moves) {
  const list = document.querySelector('#moveHistory');
  list.innerHTML = moves.length ? [...moves].reverse().map(move => `<article class="history-entry">
    <span class="history-thumb">${move.imageUrl ? `<img src="${escapeHtml(move.imageUrl)}" data-preview alt="Agrandir ${escapeHtml(move.name)}">` : '◫'}</span>
    <div><strong>${escapeHtml(move.name || move.partNum)}</strong><span>${escapeHtml(move.colorName || 'Couleur inconnue')} · ${escapeHtml(move.partNum)}${move.quantity == null ? '' : ` · × ${move.quantity}`}</span><span>${new Date(move.movedAt).toLocaleString('fr-FR')}</span></div>
    <div class="history-route"><b>${escapeHtml(move.originalLocation || move.fromLocation)}</b><span>→</span><b>${escapeHtml(move.currentLocation || move.toLocation)}</b></div>
  </article>`).join('') : '<p class="empty-message">Aucune pièce déplacée depuis le dernier effacement.</p>';
  document.querySelector('#clearHistory').disabled = !moves.length;
}

async function loadHistory() {
  const data = await request('/api/storage/history');
  renderHistory(data.moves || []);
}

caseForm.addEventListener('submit', event => { event.preventDefault(); loadCase(caseLocation.value); });

caseItems.addEventListener('change', event => { if (event.target.matches('[data-part-index]')) updateSelection(); });
caseItems.addEventListener('click', event => { if (event.target.matches('img[data-preview]')) event.preventDefault(); });

selectAllParts.addEventListener('change', event => {
  document.querySelectorAll('[data-part-index]').forEach(input => { input.checked = event.currentTarget.checked; });
  updateSelection();
});

moveForm.addEventListener('submit', async event => {
  event.preventDefault();
  const selected = [...document.querySelectorAll('[data-part-index]:checked')].map(input => currentItems[Number(input.dataset.partIndex)]);
  const button = moveForm.querySelector('button');
  button.disabled = true;
  button.textContent = 'Déplacement…';
  try {
    const result = await request('/api/storage/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromLocation: currentCase, toLocation: targetLocation.value, items: selected }) });
    const destination = targetLocation.value.trim();
    targetLocation.value = '';
    await Promise.all([loadCases(), loadHistory()]);
    await loadCase(currentCase);
    caseStatus.textContent = `${result.movedCount} référence${result.movedCount === 1 ? '' : 's'} déplacée${result.movedCount === 1 ? '' : 's'} vers ${destination}.${result.sourceEmpty ? ` La case ${currentCase} est maintenant vide.` : ''}`;
  } catch (error) { caseStatus.textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Changer la case'; }
});

document.querySelector('#clearHistory').addEventListener('click', async () => {
  const data = await request('/api/storage/history/clear', { method: 'POST' });
  renderHistory(data.moves || []);
  await loadCases();
  if (currentCase) await loadCase(currentCase);
  document.querySelector('#historyStatus').textContent = `${data.revertedCount || 0} pièce${data.revertedCount === 1 ? '' : 's'} replacée${data.revertedCount === 1 ? '' : 's'} dans la case d’origine. Historique effacé.`;
});

document.querySelector('#resyncLocations').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Synchronisation…';
  caseStatus.textContent = 'Nouvel export de la liste Rebrickable et réapplication de l’historique en cours…';
  try {
    const result = await syncLocationsViaExtension();
    await Promise.all([loadCases(), loadHistory()]);
    if (currentCase) await loadCase(currentCase);
    caseStatus.textContent = `${result.count} emplacements resynchronisés. Les déplacements de l’historique ont été conservés.`;
  } catch (error) {
    caseStatus.textContent = error.message;
  } finally {
    button.disabled = !extensionReady;
    button.textContent = 'Resynchroniser Rebrickable';
  }
});

Promise.all([loadCases(), loadHistory()]).catch(error => { caseStatus.textContent = error.message; });
