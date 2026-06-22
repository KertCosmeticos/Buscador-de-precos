const activePorts = new Set();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePost(port, message) {
  try { port.postMessage(message); } catch { /* A página pode ter sido fechada. */ }
}

function waitForTab(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('O Google demorou demais para carregar.'));
    }, timeout);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromTab(tabId, product) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_GOOGLE_RESULTS', product });
    } catch (error) {
      lastError = error;
      await delay(800);
    }
  }
  throw lastError || new Error('Não foi possível ler a página do Google.');
}

async function searchGoogle(product, mode) {
  const query = product.name || product.ean;
  const parameters = new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'br' });
  if (mode === 'shopping') parameters.set('tbm', 'shop');
  const tab = await chrome.tabs.create({
    url: `https://www.google.com/search?${parameters}`,
    active: false
  });
  let keepOpen = false;
  try {
    await waitForTab(tab.id);
    await delay(1800);
    const result = await extractFromTab(tab.id, product);
    if (result?.captcha) {
      keepOpen = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('O Google solicitou uma verificação. Resolva o CAPTCHA na aba aberta e tente novamente.');
    }
    return { mode, listings: result?.listings || [] };
  } finally {
    if (!keepOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return value || '';
  }
}

function deduplicate(listings) {
  const byLink = new Map();
  listings.forEach((listing) => {
    const link = normalizeLink(listing.link);
    if (!link) return;
    const normalized = { ...listing, link };
    const current = byLink.get(link);
    if (!current || normalized.price < current.price) byLink.set(link, normalized);
  });
  return [...byLink.values()];
}

async function runSearch(port, message) {
  const requestId = message.requestId;
  const products = Array.isArray(message.products) ? message.products.slice(0, 5) : [];
  if (!products.length) throw new Error('Nenhum produto válido foi enviado à extensão.');
  const results = [];
  const totalSteps = products.length * 2;
  let completedSteps = 0;

  for (const product of products) {
    const listings = [];
    const sources = [];
    for (const mode of ['web', 'shopping']) {
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `Pesquisando ${product.name || product.ean} no Google ${mode === 'web' ? 'Web' : 'Shopping'}…`
      });
      try {
        const search = await searchGoogle(product, mode);
        listings.push(...search.listings);
        sources.push({ name: mode === 'web' ? 'Google Web (Chrome)' : 'Google Shopping (Chrome)', status: 'ok', count: search.listings.length });
      } catch (error) {
        sources.push({ name: mode === 'web' ? 'Google Web (Chrome)' : 'Google Shopping (Chrome)', status: 'error', count: 0, error: error.message });
        if (/CAPTCHA|verificação/i.test(error.message)) throw error;
      }
      completedSteps += 1;
    }
    results.push({ ean: product.ean, listings: deduplicate(listings), sources });
  }

  safePost(port, { type: 'BROWSER_SEARCH_RESULT', requestId, results });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'price-monitor-bridge') return;
  activePorts.add(port);
  port.onDisconnect.addListener(() => activePorts.delete(port));
  port.onMessage.addListener((message) => {
    if (message.type === 'BROWSER_EXTENSION_PING') {
      safePost(port, { type: 'BROWSER_EXTENSION_STATUS', available: true });
      return;
    }
    if (message.type !== 'BROWSER_SEARCH_REQUEST') return;
    runSearch(port, message).catch((error) => {
      safePost(port, { type: 'BROWSER_SEARCH_ERROR', requestId: message.requestId, error: error.message });
    });
  });
});
