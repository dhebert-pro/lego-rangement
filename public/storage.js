const caseForm = document.querySelector('#caseForm');
const caseLocation = document.querySelector('#caseLocation');
const caseItems = document.querySelector('#caseItems');
const caseStatus = document.querySelector('#caseStatus');
const caseActions = document.querySelector('#caseActions');
const moveForm = document.querySelector('#moveForm');
const targetLocation = document.querySelector('#targetLocation');
const selectAllParts = document.querySelector('#selectAllParts');
let occupiedCases = [];
let emptyCases = [];
let currentCase = '';
let currentItems = [];

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Opération impossible.');
  return data;
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

function renderCaseLists() {
  document.querySelector('#occupiedCount').textContent = `${occupiedCases.length} cases occupées`;
  document.querySelector('#occupiedCases').innerHTML = occupiedCases.map(item => `<option value="${escapeHtml(item.location)}">${item.referenceCount} références</option>`).join('');
  document.querySelector('#allCases').innerHTML = [...occupiedCases.map(item => item.location), ...emptyCases.map(item => item.location)]
    .filter((value, index, values) => values.indexOf(value) === index).map(location => `<option value="${escapeHtml(location)}"></option>`).join('');
  document.querySelector('#emptyCount').textContent = emptyCases.length;
  document.querySelector('#emptyCasesList').innerHTML = emptyCases.length ? emptyCases.map(item => `<span class="empty-case">${escapeHtml(item.location)}<button type="button" data-remove-empty="${escapeHtml(item.location)}" aria-label="Retirer la case vide ${escapeHtml(item.location)}">×</button></span>`).join('') : '<p class="empty-message">Aucune case vide enregistrée.</p>';
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
    <div class="history-route"><b>${escapeHtml(move.fromLocation)}</b><span>→</span><b>${escapeHtml(move.toLocation)}</b></div>
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

document.querySelector('#emptyCaseForm').addEventListener('submit', async event => {
  event.preventDefault();
  const location = document.querySelector('#emptyCaseLocation').value.trim();
  const status = document.querySelector('#emptyStatus');
  try {
    await request('/api/storage/empty-cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location }) });
    document.querySelector('#emptyCaseLocation').value = '';
    await loadCases();
    status.textContent = `Case vide ${location} ajoutée.`;
  } catch (error) { status.textContent = error.message; }
});

document.querySelector('#emptyCasesList').addEventListener('click', async event => {
  const button = event.target.closest('[data-remove-empty]');
  if (!button) return;
  const location = button.dataset.removeEmpty;
  try {
    await request('/api/storage/empty-cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', location }) });
    await loadCases();
    document.querySelector('#emptyStatus').textContent = `Case ${location} retirée de la liste.`;
  } catch (error) { document.querySelector('#emptyStatus').textContent = error.message; }
});

document.querySelector('#clearHistory').addEventListener('click', async () => {
  const data = await request('/api/storage/history/clear', { method: 'POST' });
  renderHistory(data.moves || []);
  document.querySelector('#historyStatus').textContent = 'Historique effacé. Les nouveaux emplacements sont conservés.';
});

Promise.all([loadCases(), loadHistory()]).catch(error => { caseStatus.textContent = error.message; });
