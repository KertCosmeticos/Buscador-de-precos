importScripts('product-matcher.js');

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

async function extractFromTab(tabId, messageType, payload) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: messageType, ...payload });
    } catch (error) {
      lastError = error;
      await delay(800);
    }
  }
  throw lastError || new Error('Não foi possível ler a página.');
}

// Abre uma aba no Google com a query recebida e extrai os resultados.
// O objeto `product` é passado ao extractor para aplicar filtros de relevância.
async function searchGoogleByQuery(query, product, mode = 'web') {
  const parameters = new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'br', num: '30' });
  if (mode === 'shopping') parameters.set('tbm', 'shop');
  const tab = await chrome.tabs.create({
    url: `https://www.google.com/search?${parameters}`,
    active: false,
  });
  let keepOpen = false;
  try {
    await waitForTab(tab.id);
    await delay(mode === 'shopping' ? 3500 : 2000);
    const result = await extractFromTab(tab.id, 'EXTRACT_GOOGLE_RESULTS', { product });
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

function mlSlug(query) {
  return query
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function searchMercadoLivre(product) {
  const query = (product.name || product.ean).trim();
  const slug  = mlSlug(query);
  const tab   = await chrome.tabs.create({ url: `https://lista.mercadolivre.com.br/${slug}`, active: false });
  try {
    await waitForTab(tab.id);
    await delay(2500);
    const result = await extractFromTab(tab.id, 'EXTRACT_ML_RESULTS', { product });
    return { mode: 'ml', listings: result?.listings || [] };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag|source|medium|campaign)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return value || ''; }
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
  const products  = Array.isArray(message.products) ? message.products.slice(0, 5) : [];
  if (!products.length) throw new Error('Nenhum produto válido foi enviado à extensão.');

  const results = [];
  // 5 etapas: EAN + nome + consulta semântica + Shopping + Mercado Livre.
  const totalSteps = products.length * 5;
  let completedSteps = 0;

  for (const product of products) {
    const listings = [];
    const sources  = [];
    const label    = product.name || product.ean;

    // ── Etapa 1: busca por EAN ────────────────────────────────────────────────
    // EAN retorna páginas que expõem o código de barras — resultado muito preciso.
    // O flag searchByEan desativa o filtro de cor no extractor, pois a especificidade
    // do EAN já garante que a página é do produto correto.
    if (product.ean) {
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `Pesquisando ${label} por código de barras (EAN)…`,
      });
      try {
        const search = await searchGoogleByQuery(product.ean, { ...product, searchMode: 'ean' }, 'web');
        listings.push(...search.listings);
        sources.push({ name: 'Google EAN (Chrome)', status: 'ok', count: search.listings.length });
      } catch (error) {
        sources.push({ name: 'Google EAN (Chrome)', status: 'error', count: 0, error: error.message });
        if (/CAPTCHA|verificação/i.test(error.message)) throw error;
      }
      completedSteps += 1;
    } else {
      completedSteps += 1; // mantém contagem correta mesmo sem EAN
    }

    // ── Etapa 2: nome oficial ─────────────────────────────────────────────────
    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Pesquisando ${label} pelo nome oficial…`,
    });
    try {
      const search = await searchGoogleByQuery(product.name || product.ean, product, 'web');
      listings.push(...search.listings);
      sources.push({ name: 'Google Nome (Chrome)', status: 'ok', count: search.listings.length });
    } catch (error) {
      sources.push({ name: 'Google Nome (Chrome)', status: 'error', count: 0, error: error.message });
      if (/CAPTCHA|verificação/i.test(error.message)) throw error;
    }
    completedSteps += 1;

    // ── Etapa 3: palavras-chave semânticas ───────────────────────────────────
    const semanticQuery = ProductMatcher.buildSemanticQuery(product);
    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Garimpando variações de nome para ${label}…`,
    });
    try {
      const search = semanticQuery
        ? await searchGoogleByQuery(semanticQuery, product, 'web')
        : { listings: [] };
      listings.push(...search.listings);
      sources.push({ name: 'Google Semântico (Chrome)', status: 'ok', count: search.listings.length });
    } catch (error) {
      sources.push({ name: 'Google Semântico (Chrome)', status: 'error', count: 0, error: error.message });
      if (/CAPTCHA|verificação/i.test(error.message)) throw error;
    }
    completedSteps += 1;

    // ── Etapa 4: Google Shopping ──────────────────────────────────────────────
    for (const mode of ['shopping']) {
      const modeLabel = mode === 'web' ? 'Google Web' : 'Google Shopping';
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `Pesquisando ${label} no ${modeLabel}…`,
      });
      try {
        const search = await searchGoogleByQuery(product.name || product.ean, product, mode);
        listings.push(...search.listings);
        sources.push({ name: `${modeLabel} (Chrome)`, status: 'ok', count: search.listings.length });
      } catch (error) {
        sources.push({ name: `${modeLabel} (Chrome)`, status: 'error', count: 0, error: error.message });
        if (/CAPTCHA|verificação/i.test(error.message)) throw error;
      }
      completedSteps += 1;
    }

    // ── Etapa 5: Mercado Livre ────────────────────────────────────────────────
    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Pesquisando ${label} no Mercado Livre…`,
    });
    try {
      const ml = await searchMercadoLivre(product);
      listings.push(...ml.listings);
      sources.push({ name: 'Mercado Livre (Chrome)', status: 'ok', count: ml.listings.length });
    } catch (error) {
      sources.push({ name: 'Mercado Livre (Chrome)', status: 'error', count: 0, error: error.message });
    }
    completedSteps += 1;

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
