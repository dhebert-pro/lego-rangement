(() => {
  if (document.querySelector('#lego-rangement-sync')) return;

  const button = document.createElement('button');
  button.id = 'lego-rangement-sync';
  button.textContent = 'Exporter vers LEGO Rangement';
  Object.assign(button.style, {
    position: 'fixed', right: '22px', bottom: '22px', zIndex: '2147483647',
    padding: '13px 19px', border: '0', borderRadius: '7px', cursor: 'pointer',
    background: '#ffd328', color: '#17211d', font: '800 14px system-ui',
    boxShadow: '0 6px 24px rgba(0,0,0,.28)'
  });
  document.body.appendChild(button);

  const controls = () => [...document.querySelectorAll('a, button, input, [role="menuitem"]')];
  const text = element => (element.textContent || '').replace(/\s+/g, ' ').trim();
  const label = element => [text(element), element?.value, element?.getAttribute?.('title'), element?.getAttribute?.('aria-label'), element?.getAttribute?.('data-original-title')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const visible = element => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));

  function targetFrom(element) {
    if (!element) return null;
    const candidates = [element, element.closest?.('a'), element.closest?.('form')].filter(Boolean);
    for (const candidate of candidates) {
      const direct = ['href', 'data-href', 'data-url', 'formaction', 'action'].map(name => candidate.getAttribute?.(name)).find(Boolean);
      if (direct && direct !== '#' && !/^javascript:/i.test(direct)) return direct;
      const onclick = candidate.getAttribute?.('onclick') || '';
      const embedded = onclick.match(/["']([^"']*(?:csv|export|backup)[^"']*)["']/i)?.[1];
      if (embedded) return embedded;
    }
    return null;
  }

  async function readCsvResponse(response) {
    if (!response.ok) throw new Error(`Export Rebrickable impossible (${response.status}).`);
    const content = await response.text();
    if (!/^\s*Part\s*,\s*Color\s*,/i.test(content)) throw new Error('Le fichier reçu n’est pas un export Rebrickable CSV.');
    return content;
  }

  async function downloadControl(control) {
    const form = control?.form || control?.closest?.('form');
    if (form) {
      const method = String(control.formMethod || form.method || 'GET').toUpperCase();
      const url = new URL(control.formAction || form.action || location.href, location.href);
      const data = new FormData(form);
      if (control.name) data.set(control.name, control.value || '');
      const options = { method, credentials: 'include' };
      if (method === 'GET') {
        for (const [key, value] of data) url.searchParams.append(key, value);
      } else if ((form.enctype || '').includes('multipart/form-data')) {
        options.body = data;
      } else {
        options.headers = { 'content-type': 'application/x-www-form-urlencoded' };
        options.body = new URLSearchParams([...data]);
      }
      return readCsvResponse(await fetch(url, options));
    }
    const target = targetFrom(control);
    if (!target) throw new Error('Lien d’export CSV non accessible.');
    return readCsvResponse(await fetch(new URL(target, location.href), { credentials: 'include' }));
  }

  async function waitForCsvControl() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matches = [...document.querySelectorAll('a, button, input, [role="menuitem"], li, label, span, div')]
        .filter(element => /rebrickable.*csv|csv.*rebrickable/i.test(label(element)) && label(element).length < 120);
      const candidate = matches.find(element => !matches.some(other => other !== element && element.contains(other))) || matches[0];
      if (candidate) return candidate.closest?.('a, button, input, [role="menuitem"]') || candidate;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
  }

  async function exportCsv() {
    let exportControl = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      exportControl = controls().find(element => /export\s+parts/i.test(label(element)) && visible(element));
      if (exportControl) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    exportControl ||= controls().find(element => /export\s+parts/i.test(label(element)));
    if (!exportControl) throw new Error('Bouton « Export Parts » introuvable.');
    exportControl.click();
    const csvControl = await waitForCsvControl();
    if (!csvControl) throw new Error('Option « Rebrickable CSV » introuvable.');
    return downloadControl(csvControl);
  }

  const inventoryOf = value => {
    try { return new URL(value).searchParams.get('inventory'); } catch { return null; }
  };

  async function performSync(mode, sourceUrl = location.href) {
    if (mode === 'set') {
      const requested = inventoryOf(sourceUrl);
      const actual = inventoryOf(location.href);
      if (requested && actual !== requested) throw new Error(`Rebrickable a ouvert l’inventaire ${actual || 'par défaut'} au lieu de ${requested}.`);
    }
    if (mode === 'moc' && location.hash !== '#parts') {
      const partsTab = controls().find(element => {
        try { return new URL(element.href || '', location.href).hash === '#parts'; } catch { return false; }
      });
      if (partsTab) partsTab.click();
      else location.hash = 'parts';
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    const content = await exportCsv();
    if (mode === 'locations-read') return { content, count: Math.max(0, content.split(/\r?\n/).filter(Boolean).length - 1) };
    const metadata = {
      name: document.querySelector('meta[property="og:title"]')?.content || document.querySelector('h1')?.textContent || document.title,
      imageUrl: document.querySelector('meta[property="og:image"]')?.content || ''
    };
    const message = mode === 'set'
      ? { type: 'SAVE_SET_CSV', content, sourceUrl: location.href }
      : mode === 'moc'
        ? { type: 'SAVE_MODEL_CSV', content, sourceUrl, metadata }
        : { type: 'SAVE_CSV', content };
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Import local impossible.');
    return response;
  }

  const locationFormCache = new Map();
  const targetIdentity = item => `${String(item.partNum || '').trim().toLowerCase()}|${Number(item.colorId)}`;
  const dataAttribute = (element, name) => element?.getAttribute?.(`data-${name}`) ?? element?.getAttribute?.(`data-${name.replaceAll('_', '-')}`) ?? '';

  function pageInformation() {
    const paginationLinks = [...document.querySelectorAll('.pagination a[href]')];
    const links = paginationLinks.length ? paginationLinks : [...document.querySelectorAll('a[href]')];
    const pages = links.map(link => {
      try { return Number(new URL(link.href, location.href).searchParams.get('page')); } catch { return 0; }
    }).filter(Number.isInteger).filter(value => value > 0);
    return { page: Number(new URL(location.href).searchParams.get('page') || 1), pageCount: Math.max(1, ...pages) };
  }

  function partTiles() {
    return [...document.querySelectorAll('.js-part > div')].map(tile => {
      const candidates = [...tile.querySelectorAll('.js-part-data, .js-part-popup, [data-list_part_id], [data-list-part-id]')];
      const popup = candidates.find(element => element.classList.contains('js-part-popup') && dataAttribute(element, 'url'))
        || candidates.find(element => dataAttribute(element, 'url'));
      const partNum = candidates.map(element => dataAttribute(element, 'part_num')).find(Boolean)
        || tile.querySelector('a[href*="/parts/"]')?.href.match(/\/parts\/([^/]+)/i)?.[1] || '';
      const colorIdText = candidates.map(element => dataAttribute(element, 'color_id')).find(value => /^-?\d+$/.test(String(value))) || '';
      const listPartId = candidates.map(element => dataAttribute(element, 'list_part_id')).find(Boolean) || '';
      return { tile, candidates, popup, partNum: decodeURIComponent(partNum), colorId: /^-?\d+$/.test(String(colorIdText)) ? Number(colorIdText) : null, listPartId };
    }).filter(item => item.partNum && item.colorId != null && item.listPartId && item.popup);
  }

  async function locationFormFor(tile, target) {
    const popup = tile.popup;
    const popupUrl = new URL(dataAttribute(popup, 'url') || popup.href, location.href);
    const params = new URLSearchParams({
      can_edit: dataAttribute(popup, 'can_edit') || '1',
      color_id: String(target.colorId),
      list_part_id: String(tile.listPartId),
      list_part_type: dataAttribute(popup, 'list_part_type'),
      has_error: dataAttribute(popup, 'has_error'),
      page_querystring: encodeURIComponent(location.search)
    });
    params.forEach((value, key) => popupUrl.searchParams.set(key, value));
    const response = await fetch(popupUrl, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) throw new Error(`Formulaire ${target.partNum}/${target.colorId} inaccessible (${response.status}).`);
    const payload = await response.json().catch(() => ({}));
    if (payload.status !== 'success' || !payload.html) throw new Error(payload.msg || `Formulaire ${target.partNum}/${target.colorId} invalide.`);
    const documentCopy = new DOMParser().parseFromString(payload.html, 'text/html');
    const fields = [...documentCopy.querySelectorAll('input, textarea, select')].filter(field => {
      const labelText = field.id ? documentCopy.querySelector(`label[for="${CSS.escape(field.id)}"]`)?.textContent || '' : '';
      return /(?:^|[^a-z])(location|emplacement)(?:[^a-z]|$)/i.test([field.name, field.id, field.placeholder, labelText].filter(Boolean).join(' '));
    });
    if (fields.length !== 1 || !fields[0].name || !fields[0].form) throw new Error(`Champ Location ambigu pour ${target.partNum}/${target.colorId}.`);
    const field = fields[0];
    const form = field.form;
    const method = String(form.method || 'POST').toUpperCase();
    if (method !== 'POST') throw new Error(`Méthode de formulaire inattendue pour ${target.partNum}/${target.colorId}.`);
    const action = new URL(form.getAttribute('action') || popupUrl, popupUrl).href;
    const values = [...new FormData(form).entries()].filter(([, value]) => typeof value === 'string');
    const currentLocation = String(field.value || '').trim();
    if (currentLocation !== String(target.beforeLocation || '').trim()) {
      throw new Error(`La case de ${target.partNum}/${target.colorId} a changé pendant la préparation (${currentLocation || 'vide'} au lieu de ${target.beforeLocation || 'vide'}).`);
    }
    return { action, method, values, locationField: field.name, currentLocation };
  }

  async function inspectLocationTargets(targets) {
    for (let attempt = 0; attempt < 80 && !document.querySelector('.js-part-data'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const tiles = partTiles();
    if (!tiles.length) throw new Error('Aucune tuile de pièce modifiable trouvée sur cette page Rebrickable.');
    const found = [];
    for (const target of targets || []) {
      const matches = tiles.filter(tile => targetIdentity(tile) === targetIdentity(target));
      if (!matches.length) continue;
      if (matches.length !== 1) throw new Error(`${matches.length} tuiles correspondent à ${target.partNum}/${target.colorId}.`);
      const identity = targetIdentity(target);
      locationFormCache.set(identity, await locationFormFor(matches[0], target));
      found.push(identity);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { ...pageInformation(), found };
  }

  async function applyLocationTargets(targets) {
    const applied = [];
    for (const target of targets || []) {
      try {
        const identity = targetIdentity(target);
        const blueprint = locationFormCache.get(identity);
        if (!blueprint) throw new Error(`Formulaire préparé introuvable pour ${target.partNum}/${target.colorId}.`);
        const body = new URLSearchParams(blueprint.values);
        body.set(blueprint.locationField, String(target.expectedLocation || '').trim());
        const response = await fetch(blueprint.action, {
          method: blueprint.method,
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== 'success') throw new Error(data.msg || `Rebrickable a refusé ${target.partNum}/${target.colorId} (${response.status}).`);
        applied.push(identity);
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (error) {
        return { ...pageInformation(), applied, error: error.message };
      }
    }
    return { ...pageInformation(), applied };
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Export en cours…';
    button.style.background = '#ffd328';
    try {
      const mode = location.pathname.startsWith('/sets/') ? 'set' : location.pathname.startsWith('/mocs/') ? 'moc' : 'locations';
      const response = mode === 'locations' && !location.pathname.startsWith('/users/sourivore/partlists/108467')
        ? await chrome.runtime.sendMessage({ type: 'SYNC_DEFAULT_LOCATIONS' })
        : await performSync(mode);
      button.textContent = mode === 'locations'
        ? `${response.count} emplacements synchronisés ✓`
        : `${response.count} références synchronisées ✓`;
      button.style.background = '#91e0b9';
    } catch (error) {
      button.textContent = error.message;
      button.style.background = '#ff9b8d';
    } finally {
      setTimeout(() => { button.disabled = false; }, 1500);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['AUTO_EXPORT', 'AUTO_UPDATE_LOCATIONS'].includes(message?.type)) return;
    const operation = message.type === 'AUTO_UPDATE_LOCATIONS'
      ? (message.phase === 'apply' ? applyLocationTargets(message.targets) : inspectLocationTargets(message.targets))
      : performSync(message.mode, message.sourceUrl);
    operation
      .then(result => respond({ ok: true, ...result }))
      .catch(error => respond({ ok: false, error: error.message }));
    return true;
  });

  if (location.pathname.startsWith('/users/sourivore/partlists/108467')) {
    if (document.visibilityState === 'visible') performSync('locations').catch(() => {});
  } else {
    chrome.runtime.sendMessage({ type: 'SYNC_DEFAULT_LOCATIONS' }).catch(() => {});
  }
})();
