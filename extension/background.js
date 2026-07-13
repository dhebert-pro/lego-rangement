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

async function locationUpdateProgress(message, current = 0, total = 0) {
  const tabs = await chrome.tabs.query({ url: 'http://localhost:3000/*' });
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'LOCATION_UPDATE_PROGRESS', message, current, total }).catch(() => {})));
}

async function syncInBackground(url, mode) {
  const target = new URL(url);
  const defaultList = /^\/users\/sourivore\/partlists\/108467\/?$/.test(target.pathname);
  const model = /^\/(?:sets|mocs)\//.test(target.pathname);
  const allowed = mode.startsWith('locations') ? defaultList : model;
  if (target.origin !== 'https://rebrickable.com' || !allowed) {
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

async function syncDefaultLocations() {
  if (defaultLocationsPromise) return defaultLocationsPromise;
  defaultLocationsPromise = syncInBackground(DEFAULT_PART_LIST, 'locations');
  try { return await defaultLocationsPromise; }
  finally { defaultLocationsPromise = null; }
}

async function openLocationUpdatePage(page, targets) {
  const target = new URL(DEFAULT_PART_LIST);
  target.searchParams.set('page', String(page));
  target.searchParams.set('lego_rangement_update', '1');
  const tab = await chrome.tabs.create({ url: target.href, active: false });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await delay(500);
      let result;
      try {
        result = await chrome.tabs.sendMessage(tab.id, { type: 'AUTO_UPDATE_LOCATIONS', phase: 'inspect', targets });
      } catch (error) { if (attempt === 59) throw error; else continue; }
      if (!result) continue;
      if (!result.ok) throw new Error(result.error || `Préparation impossible sur la page ${page}.`);
      return { tabId: tab.id, page, result };
    }
    throw new Error(`La page Rebrickable ${page} n’a pas répondu.`);
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}

async function applyRebrickableLocations() {
  await locationUpdateProgress('Export Rebrickable avant modification…');
  const before = await syncInBackground(DEFAULT_PART_LIST, 'locations-read');
  const preflight = await postLocal('/api/storage/rebrickable-locations/preflight', { content: before.content });
  if (!preflight.ready) throw new Error(`${preflight.conflictCount} correspondance Rebrickable ambiguë. Aucun changement n’a été effectué.`);
  if (!preflight.targetCount) {
    await locationUpdateProgress('Toutes les Location sont déjà correctes. Vérification finale…');
    const report = await postLocal('/api/storage/rebrickable-locations/verify', { beforeContent: before.content, afterContent: before.content });
    return { ...report, appliedCount: 0, targetCount: 0, alreadyCorrect: preflight.alreadyCorrect, missingCount: preflight.missingCount };
  }

  const targetsByIdentity = new Map(preflight.targets.map(target => [`${String(target.partNum).toLowerCase()}|${Number(target.colorId)}`, target]));
  const unresolved = new Map(targetsByIdentity);
  const pages = [];
  const foundOnPage = new Map();
  let pageCount = 1;
  let appliedCount = 0;
  let operationError = '';
  try {
    for (let page = 1; page <= pageCount; page += 1) {
      await locationUpdateProgress(`Contrôle des formulaires Rebrickable — page ${page}/${pageCount}`, page, pageCount);
      const session = await openLocationUpdatePage(page, [...unresolved.values()]);
      pages.push(session);
      if (page === 1) {
        pageCount = Number(session.result.pageCount) || 1;
        if (pageCount > 50) throw new Error('La pagination Rebrickable est anormalement grande. Aucun changement n’a été effectué.');
      }
      for (const identity of session.result.found || []) {
        if (!unresolved.has(identity)) throw new Error(`La pièce ${identity} apparaît sur plusieurs pages. Aucun changement n’a été effectué.`);
        foundOnPage.set(identity, page);
        unresolved.delete(identity);
      }
    }
    if (unresolved.size) {
      const sample = [...unresolved.values()].slice(0, 5).map(item => `${item.partNum}/${item.colorId}`).join(', ');
      throw new Error(`${unresolved.size} pièce(s) n’ont pas été retrouvées dans les pages Rebrickable (${sample}). Aucun changement n’a été effectué.`);
    }

    for (const session of pages) {
      const targets = preflight.targets.filter(target => foundOnPage.get(`${String(target.partNum).toLowerCase()}|${Number(target.colorId)}`) === session.page);
      if (!targets.length) continue;
      await locationUpdateProgress(`Mise à jour des Location — page ${session.page}/${pageCount}`, appliedCount, preflight.targetCount);
      const result = await chrome.tabs.sendMessage(session.tabId, { type: 'AUTO_UPDATE_LOCATIONS', phase: 'apply', targets });
      if (!result?.ok) throw new Error(result?.error || `Écriture impossible sur la page ${session.page}.`);
      appliedCount += Number(result.applied?.length || 0);
      if (result.error) throw new Error(result.error);
    }
  } catch (error) {
    operationError = error.message;
    if (!appliedCount) throw error;
  } finally {
    await Promise.all(pages.map(session => chrome.tabs.remove(session.tabId).catch(() => {})));
  }

  await delay(1500);
  await locationUpdateProgress('Nouvel export et vérification intégrale de la liste…', appliedCount, preflight.targetCount);
  const after = await syncInBackground(DEFAULT_PART_LIST, 'locations-read');
  const report = await postLocal('/api/storage/rebrickable-locations/verify', { beforeContent: before.content, afterContent: after.content });
  return {
    ...report,
    appliedCount,
    targetCount: preflight.targetCount,
    alreadyCorrect: preflight.alreadyCorrect,
    missingCount: preflight.missingCount,
    operationError
  };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message?.type === 'SAVE_CSV') return postLocal('/api/locations/import', { content: message.content });
    if (message?.type === 'SAVE_SET_CSV') return postLocal('/api/set-inventory/import', { sourceUrl: message.sourceUrl, content: message.content });
    if (message?.type === 'SAVE_MODEL_CSV') return postLocal('/api/model-inventory/import', { sourceUrl: message.sourceUrl, content: message.content, metadata: message.metadata });
    if (message?.type === 'SYNC_DEFAULT_LOCATIONS') return syncDefaultLocations();
    if (message?.type === 'SYNC_URL') return message.mode === 'locations' ? syncDefaultLocations() : syncInBackground(message.url, message.mode);
    if (message?.type === 'APPLY_REBRICKABLE_LOCATIONS') return applyRebrickableLocations();
    throw new Error('Commande inconnue.');
  })().then(data => respond({ ok: true, ...data })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
