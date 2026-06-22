importScripts('product-matcher.js', 'retail-stores.js');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePost(port, message) {
  try { port.postMessage(message); } catch { /* painel fechado */ }
}

function waitForTab(tabId, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('A página demorou demais para carregar.'));
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

async function updateTabAndWait(tabId, url, timeout = 25000) {
  // Registra o observador antes da navegação para não perder páginas que
  // carregam muito rápido e acabar esperando o timeout inteiro.
  const loaded = waitForTab(tabId, timeout);
  await chrome.tabs.update(tabId, { url });
  await loaded;
}

async function sendToTab(tabId, type, payload = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type, ...payload });
    } catch (error) {
      lastError = error;
      await delay(600);
    }
  }
  throw lastError || new Error('Não foi possível ler a loja.');
}

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag|source|campaign)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return value || ''; }
}

function deduplicate(listings) {
  const byLink = new Map();
  listings.forEach((listing) => {
    const link = normalizeLink(listing.link);
    if (!link || !Number.isFinite(listing.price)) return;
    const current = byLink.get(link);
    if (!current || listing.price < current.price) byLink.set(link, { ...listing, link });
  });
  return [...byLink.values()];
}

async function navigateStoreSearch(tabId, query, store) {
  const discovery = await sendToTab(tabId, 'DISCOVER_STORE_SEARCH', { query }).catch(() => null);
  if (discovery?.url) {
    await updateTabAndWait(tabId, discovery.url);
  } else if (discovery?.submitted) {
    // Algumas lojas atualizam os resultados por JavaScript, sem nova navegação.
    await waitForTab(tabId, 7000).catch(() => {});
  } else {
    const fallback = new URL('/busca', store.url);
    fallback.searchParams.set('q', query);
    await updateTabAndWait(tabId, fallback.href);
  }
  await delay(900);
}

async function searchRetailStore(product, store) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  try {
    await updateTabAndWait(tab.id, store.url);
    await delay(500);
    const attempts = [product.ean, product.name].filter(Boolean);
    for (let index = 0; index < attempts.length; index += 1) {
      await navigateStoreSearch(tab.id, attempts[index], store);
      let extracted = await sendToTab(tab.id, 'EXTRACT_STORE_RESULTS', { product, store });
      if (extracted?.blocked) return { status: 'blocked', listings: [] };
      if (extracted?.listings?.length) return { status: 'ok', listings: extracted.listings };
      // Algumas vitrines renderizam os cartões depois do evento de carregamento.
      await delay(1200);
      extracted = await sendToTab(tab.id, 'EXTRACT_STORE_RESULTS', { product, store });
      if (extracted?.blocked) return { status: 'blocked', listings: [] };
      if (extracted?.listings?.length) return { status: 'ok', listings: extracted.listings };
    }
    return { status: 'not_found', listings: [] };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runSearch(port, message) {
  const requestId = message.requestId;
  const products = Array.isArray(message.products) ? message.products.slice(0, 1) : [];
  if (!products.length) throw new Error('Nenhum produto válido foi enviado à extensão.');

  const results = [];
  const totalSteps = products.length * RetailStores.length;
  let completedSteps = 0;

  for (const product of products) {
    const listings = [];
    const sources = [];
    const label = product.name || product.ean;
    let nextStore = 0;
    const worker = async () => {
      while (nextStore < RetailStores.length) {
        const store = RetailStores[nextStore];
        nextStore += 1;
        safePost(port, {
          type: 'BROWSER_SEARCH_PROGRESS', requestId,
          completed: completedSteps, total: totalSteps,
          message: `Verificando ${label} em ${store.name} (${completedSteps + 1} de ${totalSteps})…`
        });
        try {
          const search = await searchRetailStore(product, store);
          listings.push(...search.listings);
          sources.push({ name: store.name, status: search.status, count: search.listings.length });
        } catch (error) {
          sources.push({ name: store.name, status: 'error', count: 0, error: error.message });
        }
        completedSteps += 1;
      }
    };
    // Quatro abas equilibram velocidade, memória e risco de bloqueio.
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    results.push({ ean: product.ean, listings: deduplicate(listings), sources });
  }
  safePost(port, { type: 'BROWSER_SEARCH_RESULT', requestId, results });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'price-monitor-bridge') return;
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
