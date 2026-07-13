const LOCAL = 'http://localhost:3000';
const DEFAULT_PART_LIST = 'https://rebrickable.com/users/sourivore/partlists/108467/';
let defaultLocationsPromise = null;

async function postLocal(path, body) {
  const response = await fetch(`${LOCAL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Erreur de synchronisation locale.');
  return data;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function syncInBackground(url, mode) {
  const target = new URL(url);
  const defaultList = /^\/users\/sourivore\/partlists\/108467\/?$/.test(target.pathname);
  const verificationList = /^\/users\/sourivore\/partlists\/\d+\/?$/.test(target.pathname);
  const model = /^\/(?:sets|mocs)\//.test(target.pathname);
  const allowed = mode === 'verification' ? verificationList : mode === 'locations' ? defaultList : model;
  if (target.origin !== 'https://rebrickable.com' || !allowed) {
    throw new Error('URL Rebrickable non autorisée.');
  }
  if (mode === 'verification') target.searchParams.set('lego_rangement_verification', '1');
  if (mode === 'moc') target.hash = 'parts';
  const tab = await chrome.tabs.create({ url: target.href, active: false });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await delay(500);
      let result;
      try {
        result = await chrome.tabs.sendMessage(tab.id, { type: 'AUTO_EXPORT', mode, sourceUrl: target.href });
      } catch (error) { if (attempt === 59) throw error; else continue; }
      if (result) {
        if (!result.ok) throw new Error(result.error || 'Export automatique impossible.');
        return result;
      }
    }
    throw new Error('La page Rebrickable n’a pas répondu.');
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function syncDefaultLocations() {
  if (defaultLocationsPromise) return defaultLocationsPromise;
  defaultLocationsPromise = syncInBackground(DEFAULT_PART_LIST, 'locations');
  try { return await defaultLocationsPromise; }
  finally { defaultLocationsPromise = null; }
}

async function verifyImportedList(value) {
  const importedListId = Number(value);
  if (!Number.isInteger(importedListId) || importedListId <= 0) throw new Error('Indiquez un identifiant de liste Rebrickable valide.');
  if (importedListId === 108467) throw new Error('Indiquez l’identifiant de la nouvelle liste importée, différent de 108467.');
  const importedUrl = `https://rebrickable.com/users/sourivore/partlists/${importedListId}/`;
  const [base, imported] = await Promise.all([
    syncInBackground(DEFAULT_PART_LIST, 'verification'),
    syncInBackground(importedUrl, 'verification')
  ]);
  return postLocal('/api/storage/verify-import', {
    baseListId: 108467,
    importedListId,
    baseContent: base.content,
    importedContent: imported.content
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message?.type === 'SAVE_CSV') return postLocal('/api/locations/import', { content: message.content });
    if (message?.type === 'SAVE_SET_CSV') return postLocal('/api/set-inventory/import', { sourceUrl: message.sourceUrl, content: message.content });
    if (message?.type === 'SAVE_MODEL_CSV') return postLocal('/api/model-inventory/import', { sourceUrl: message.sourceUrl, content: message.content, metadata: message.metadata });
    if (message?.type === 'SYNC_DEFAULT_LOCATIONS') return syncDefaultLocations();
    if (message?.type === 'SYNC_URL') return message.mode === 'locations' ? syncDefaultLocations() : syncInBackground(message.url, message.mode);
    if (message?.type === 'VERIFY_IMPORTED_LIST') return verifyImportedList(message.importedListId);
    throw new Error('Commande inconnue.');
  })().then(data => respond({ ok: true, ...data })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
