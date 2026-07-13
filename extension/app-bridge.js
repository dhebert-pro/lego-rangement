(() => {
  window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: 'READY', version: chrome.runtime.getManifest().version }, location.origin);
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.source !== 'LEGO_RANGEMENT_APP') return;
    if (!['SYNC', 'APPLY_LOCATIONS'].includes(message?.type)) return;
    const applying = message.type === 'APPLY_LOCATIONS';
    const command = applying ? { type: 'APPLY_REBRICKABLE_LOCATIONS' } : { type: 'SYNC_URL', url: message.url, mode: message.mode };
    const resultType = applying ? 'APPLY_LOCATIONS_RESULT' : 'SYNC_RESULT';
    chrome.runtime.sendMessage(command)
      .then(result => window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: resultType, requestId: message.requestId, result }, location.origin))
      .catch(error => window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: resultType, requestId: message.requestId, result: { ok: false, error: error.message } }, location.origin));
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'LOCATION_UPDATE_PROGRESS') return;
    window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: 'APPLY_LOCATIONS_PROGRESS', message: message.message, current: message.current, total: message.total }, location.origin);
  });
})();
