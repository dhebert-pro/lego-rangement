(() => {
  window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: 'READY', version: chrome.runtime.getManifest().version }, location.origin);
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.source !== 'LEGO_RANGEMENT_APP') return;
    if (message?.type !== 'SYNC') return;
    chrome.runtime.sendMessage({ type: 'SYNC_URL', url: message.url, mode: message.mode })
      .then(result => window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: 'SYNC_RESULT', requestId: message.requestId, result }, location.origin))
      .catch(error => window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: 'SYNC_RESULT', requestId: message.requestId, result: { ok: false, error: error.message } }, location.origin));
  });
})();
