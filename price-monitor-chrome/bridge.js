const FROM_PAGE = 'price-monitor-web';
const FROM_EXTENSION = 'price-monitor-extension';
let port;

function tellPage(type, payload = {}) {
  window.postMessage({ source: FROM_EXTENSION, type, ...payload }, window.location.origin);
}

function connect() {
  port = chrome.runtime.connect({ name: 'price-monitor-bridge' });
  port.onMessage.addListener((message) => tellPage(message.type, message));
  port.onDisconnect.addListener(() => {
    port = null;
    tellPage('BROWSER_EXTENSION_STATUS', { available: false });
    setTimeout(connect, 1000);
  });
  tellPage('BROWSER_EXTENSION_STATUS', { available: true });
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== FROM_PAGE) return;
  if (!['BROWSER_SEARCH_REQUEST', 'BROWSER_EXTENSION_PING'].includes(message.type)) return;
  if (!port) {
    tellPage('BROWSER_SEARCH_ERROR', { requestId: message.requestId, error: 'A extensão não está conectada.' });
    return;
  }
  port.postMessage(message);
});

connect();
