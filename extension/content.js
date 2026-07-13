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
    if (message?.type !== 'AUTO_EXPORT') return;
    performSync(message.mode, message.sourceUrl)
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
