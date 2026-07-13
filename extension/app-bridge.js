(() => {
  window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: 'READY', version: chrome.runtime.getManifest().version }, location.origin);
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.source !== 'LEGO_RANGEMENT_APP') return;
    const verification = message?.type === 'VERIFY_IMPORT';
    if (!verification && message?.type !== 'SYNC') return;
    const command = verification
      ? { type: 'VERIFY_IMPORTED_LIST', importedListId: message.importedListId }
      : { type: 'SYNC_URL', url: message.url, mode: message.mode };
    const resultType = verification ? 'VERIFY_IMPORT_RESULT' : 'SYNC_RESULT';
    chrome.runtime.sendMessage(command)
      .then(result => window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: resultType, requestId: message.requestId, result }, location.origin))
      .catch(error => window.postMessage({ source: 'LEGO_RANGEMENT_EXTENSION', type: resultType, requestId: message.requestId, result: { ok: false, error: error.message } }, location.origin));
  });
})();
