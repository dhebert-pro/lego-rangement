const caseForm = document.querySelector('#caseForm');
const caseLocation = document.querySelector('#caseLocation');
const caseItems = document.querySelector('#caseItems');
const caseItemsPanel = document.querySelector('#caseItemsPanel');
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
let locationApplyReady = false;
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
  if (message.type === 'APPLY_LOCATIONS_PROGRESS') {
    const suffix = message.total ? ` (${message.current}/${message.total})` : '';
    caseStatus.textContent = `${message.message || 'Mise à jour Rebrickable…'}${suffix}`;
    document.querySelector('#applyRebrickableLocations').textContent = message.total ? `${message.current}/${message.total}` : 'Vérification…';
    return;
  }
  if (message.type === 'READY') {
    extensionReady = true;
    locationApplyReady = String(message.version || '').localeCompare('3.6.0', undefined, { numeric: true }) >= 0;
    document.querySelector('#resyncLocations').disabled = false;
    const applyButton = document.querySelector('#applyRebrickableLocations');
    applyButton.disabled = !locationApplyReady;
    applyButton.textContent = locationApplyReady ? 'Appliquer les cases sur Rebrickable' : 'Actualiser l’extension 3.6.0';
    applyButton.title = locationApplyReady ? '' : 'Actualisez l’extension LEGO Rangement 3.6.0 dans chrome://extensions.';
    return;
  }
  if (!['SYNC_RESULT', 'APPLY_LOCATIONS_RESULT'].includes(message.type)) return;
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

function applyLocationsViaExtension() {
  if (!extensionReady || !locationApplyReady) return Promise.reject(new Error('Actualisez l’extension LEGO Rangement 3.6.0 depuis chrome://extensions.'));
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    pendingExtensionSync.set(requestId, { resolve, reject });
    window.postMessage({ source: 'LEGO_RANGEMENT_APP', type: 'APPLY_LOCATIONS', requestId }, location.origin);
    setTimeout(() => {
      if (!pendingExtensionSync.has(requestId)) return;
      pendingExtensionSync.delete(requestId);
      reject(new Error('La mise à jour Rebrickable n’a pas répondu dans le délai de quinze minutes. Relancez le bouton : les lignes déjà correctes seront ignorées.'));
    }, 900000);
  });
}

function renderRebrickableReport(report) {
  const container = document.querySelector('#rebrickableReport');
  const issueTotal = Object.values(report.issueCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const details = Object.entries(report.issueCounts || {}).filter(([, count]) => count).map(([name, count]) => `<span>${escapeHtml(name)} : <b>${count}</b></span>`).join('');
  container.innerHTML = `<article class="${report.safe ? 'rebrickable-report-success' : 'rebrickable-report-failure'}">
    <strong>${report.safe ? '✓ Vérification Rebrickable réussie' : '! Vérification Rebrickable incomplète'}</strong>
    <p>${report.safe
      ? `${report.verifiedChanges} changement${report.verifiedChanges === 1 ? '' : 's'} de case vérifié${report.verifiedChanges === 1 ? '' : 's'} ; les ${report.beforeRows} lignes et tous les autres champs sont inchangés.`
      : `${report.verifiedChanges || 0} changement${report.verifiedChanges === 1 ? '' : 's'} vérifié${report.verifiedChanges === 1 ? '' : 's'}, ${issueTotal} anomalie${issueTotal === 1 ? '' : 's'} détectée${issueTotal === 1 ? '' : 's'}. Relancez le bouton après avoir lu le détail.`}</p>
    <div>${details}${report.missingCount ? `<span>Absentes de la liste : <b>${report.missingCount}</b></span>` : ''}${report.operationError ? `<span class="report-operation-error">${escapeHtml(report.operationError)}</span>` : ''}</div>
  </article>`;
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
  caseItemsPanel.hidden = !currentItems.length;
  document.querySelector('#casePanelCount').textContent = `${currentItems.length} réf.`;
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
  caseItemsPanel.hidden = true;
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
    caseItemsPanel.open = !window.matchMedia('(max-width: 700px)').matches;
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
      <div class="advice-move"><label>Case destination<input data-advice-target="${group.index}" list="allCases" value="${escapeHtml(group.suggestedLocation)}" autocomplete="off"></label><button type="button" data-move-advice-group="${group.index}">Déplacer la sélection</button></div>
      <details class="advice-parts-panel"><summary><span>Choisir les pièces</span><b><span data-advice-selected-count="${group.index}">${group.items.length}</span> / ${group.items.length}</b></summary>
      <label class="advice-select-all"><input type="checkbox" data-advice-select-all="${group.index}" checked> Tout sélectionner dans ce groupe</label>
      <div class="advice-parts">${group.items.map((item, itemIndex) => `<label class="advice-part">
        <input class="advice-part-check" type="checkbox" data-advice-part-group="${group.index}" data-advice-part-index="${itemIndex}" checked aria-label="Sélectionner ${escapeHtml(item.name)} en ${escapeHtml(item.colorName)}">
        <span class="advice-thumb">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" data-preview alt="Agrandir ${escapeHtml(item.name)}">` : '◫'}</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.colorName || 'Couleur inconnue')} · ${escapeHtml(item.partNum)}</small></span>
        <b>${item.quantity == null ? 'Qté ?' : `× ${item.quantity}`}</b>
      </label>`).join('')}</div></details>
    </article>`).join('')}</div><div class="apply-advice"><button type="button" data-apply-advice>Appliquer tout le découpage</button><span>Les déplacements seront ajoutés à l’historique.</span></div>`;
}

function updateAdviceSelection(groupIndex) {
  const inputs = [...splitAdvice.querySelectorAll(`[data-advice-part-group="${groupIndex}"]`)];
  const selected = inputs.filter(input => input.checked).length;
  const selectAll = splitAdvice.querySelector(`[data-advice-select-all="${groupIndex}"]`);
  const count = splitAdvice.querySelector(`[data-advice-selected-count="${groupIndex}"]`);
  const moveButton = splitAdvice.querySelector(`[data-move-advice-group="${groupIndex}"]`);
  if (selectAll) {
    selectAll.checked = Boolean(inputs.length) && selected === inputs.length;
    selectAll.indeterminate = selected > 0 && selected < inputs.length;
  }
  if (count) count.textContent = selected;
  if (moveButton) {
    moveButton.disabled = selected === 0;
    moveButton.textContent = selected ? `Déplacer ${selected} réf.` : 'Aucune pièce sélectionnée';
  }
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
      const selectedItems = [...splitAdvice.querySelectorAll(`[data-advice-part-group="${group.index}"]:checked`)]
        .map(input => group.items[Number(input.dataset.advicePartIndex)])
        .filter(Boolean);
      if (!group?.toLocation) throw new Error('Indiquez une case de destination.');
      if (!selectedItems.length) throw new Error('Sélectionnez au moins une pièce dans ce groupe.');
      if (group.toLocation.toLocaleLowerCase('fr') === currentCase.toLocaleLowerCase('fr')) throw new Error('Choisissez une autre case pour déplacer ce groupe.');
      result = await request('/api/storage/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromLocation: currentCase, toLocation: group.toLocation, items: selectedItems }) });
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

splitAdvice.addEventListener('change', event => {
  if (event.target.matches('[data-advice-select-all]')) {
    const groupIndex = Number(event.target.dataset.adviceSelectAll);
    splitAdvice.querySelectorAll(`[data-advice-part-group="${groupIndex}"]`).forEach(input => { input.checked = event.target.checked; });
    updateAdviceSelection(groupIndex);
  }
  if (event.target.matches('[data-advice-part-group]')) updateAdviceSelection(Number(event.target.dataset.advicePartGroup));
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
  document.querySelector('#historyCount').textContent = moves.length;
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
  caseStatus.textContent = 'Actualisation de la liste Rebrickable et réapplication de vos cases en cours…';
  try {
    const result = await syncLocationsViaExtension();
    await Promise.all([loadCases(), loadHistory()]);
    if (currentCase) await loadCase(currentCase);
    caseStatus.textContent = `${result.count} références actualisées. Les cases et l’historique de LEGO Rangement ont été conservés.`;
  } catch (error) {
    caseStatus.textContent = error.message;
  } finally {
    button.disabled = !extensionReady;
    button.textContent = 'Actualiser depuis Rebrickable';
  }
});

document.querySelector('#applyRebrickableLocations').addEventListener('click', async event => {
  if (!confirm('Appliquer sur la liste Rebrickable 108467 toutes les cases actuellement enregistrées dans LEGO Rangement ? L’extension vérifiera l’intégralité de la liste après la modification.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Préparation et vérification…';
  document.querySelector('#rebrickableReport').innerHTML = '';
  caseStatus.textContent = 'Comparaison complète, contrôle des formulaires, mise à jour des Location puis nouvel export de vérification… Cette opération peut durer plusieurs minutes.';
  try {
    const report = await applyLocationsViaExtension();
    renderRebrickableReport(report);
    caseStatus.textContent = report.safe
      ? `Rebrickable est à jour : ${report.verifiedChanges} changement${report.verifiedChanges === 1 ? '' : 's'} vérifié${report.verifiedChanges === 1 ? '' : 's'}, aucun autre champ modifié.`
      : 'La vérification n’est pas parfaite. L’historique a été conservé et un nouvel appui reprendra uniquement les différences restantes.';
  } catch (error) {
    caseStatus.textContent = error.message;
  } finally {
    button.disabled = !locationApplyReady;
    button.textContent = 'Appliquer les cases sur Rebrickable';
  }
});

document.querySelector('#downloadBackup').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Préparation…';
  try {
    const response = await fetch('/api/storage/backup');
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Sauvegarde impossible.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'lego-rangement-sauvegarde.json';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    caseStatus.textContent = 'Sauvegarde téléchargée : cases, déplacements et attributions manuelles sont inclus.';
  } catch (error) {
    caseStatus.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Sauvegarder';
  }
});

const backupFile = document.querySelector('#backupFile');
document.querySelector('#restoreBackup').addEventListener('click', () => backupFile.click());
backupFile.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!confirm('Restaurer cette sauvegarde ? Les cases et l’historique actuels seront remplacés. Une copie de sécurité automatique sera conservée sur le PC.')) return;
    caseStatus.textContent = 'Restauration des cases et de l’historique…';
    const result = await request('/api/storage/backup/restore', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(backup)
    });
    await Promise.all([loadCases(), loadHistory()]);
    if (currentCase) await loadCase(currentCase);
    caseStatus.textContent = `Sauvegarde restaurée : ${result.locationCount} emplacements et ${result.historyCount} déplacement${result.historyCount === 1 ? '' : 's'} retrouvés.`;
  } catch (error) {
    caseStatus.textContent = error instanceof SyntaxError ? 'Ce fichier JSON n’est pas une sauvegarde valide.' : error.message;
  }
});

Promise.all([loadCases(), loadHistory()]).catch(error => { caseStatus.textContent = error.message; });
