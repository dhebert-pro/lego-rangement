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
  if (target.origin !== 'https://rebrickable.com' || !/^\/(?:users\/sourivore\/partlists\/108467|sets\/|mocs\/)/.test(target.pathname)) {
    throw new Error('URL Rebrickable non autorisée.');
  }
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

async function syncDefaultLocations(force = false) {
  if (defaultLocationsPromise) return defaultLocationsPromise;
  defaultLocationsPromise = (async () => {
    const state = await chrome.storage.local.get('lastLocationSync');
    if (!force && Date.now() - Number(state.lastLocationSync || 0) < 10 * 60 * 1000) return { skipped: true };
    const result = await syncInBackground(DEFAULT_PART_LIST, 'locations');
    await chrome.storage.local.set({ lastLocationSync: Date.now() });
    return result;
  })();
  try { return await defaultLocationsPromise; }
  finally { defaultLocationsPromise = null; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message?.type === 'SAVE_CSV') return postLocal('/api/locations/import', { content: message.content });
    if (message?.type === 'SAVE_SET_CSV') return postLocal('/api/set-inventory/import', { sourceUrl: message.sourceUrl, content: message.content });
    if (message?.type === 'SAVE_MODEL_CSV') return postLocal('/api/model-inventory/import', { sourceUrl: message.sourceUrl, content: message.content, metadata: message.metadata });
    if (message?.type === 'SYNC_DEFAULT_LOCATIONS') return syncDefaultLocations(false);
    if (message?.type === 'SYNC_URL') return message.mode === 'locations' ? syncDefaultLocations(true) : syncInBackground(message.url, message.mode);
    throw new Error('Commande inconnue.');
  })().then(data => respond({ ok: true, ...data })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
