import './product-matcher.js';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePost(port, message) {
  try { port.postMessage(message); } catch { /* painel fechado */ }
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

async function navigateTab(tabId, url) {
  const loaded = waitForTab(tabId);
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
      await delay(700);
    }
  }
  throw lastError || new Error('Não foi possível ler a página de pesquisa.');
}

async function searchGoogle(query, product, mode = 'web') {
  const parameters = new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'br', num: '30' });
  if (mode === 'shopping') parameters.set('tbm', 'shop');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  let keepOpen = false;
  try {
    await navigateTab(tab.id, `https://www.google.com/search?${parameters}`);
    await delay(mode === 'shopping' ? 2600 : 1600);
    let result;
    try {
      result = await sendToTab(tab.id, 'EXTRACT_GOOGLE_RESULTS', { product });
    } catch (sendError) {
      const currentTab = await chrome.tabs.get(tab.id).catch(() => null);
      const currentUrl = currentTab?.url || '';
      if (/\/sorry\/|consent\.google|\/recaptcha/i.test(currentUrl)) {
        keepOpen = true;
        await chrome.tabs.update(tab.id, { active: true });
        throw new Error('O Google solicitou verificação. Resolva o CAPTCHA na aba aberta e repita a busca.');
      }
      throw sendError;
    }
    if (result?.captcha) {
      keepOpen = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('O Google solicitou verificação. Resolva o CAPTCHA na aba aberta e repita a busca.');
    }
    return result?.listings || [];
  } finally {
    if (!keepOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function mercadoLivreUrl(query) {
  const slug = String(query || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://lista.mercadolivre.com.br/${slug}`;
}

async function searchMercadoLivre(product) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  try {
    await navigateTab(tab.id, mercadoLivreUrl(product.name || product.ean));
    await delay(2200);
    const result = await sendToTab(tab.id, 'EXTRACT_ML_RESULTS', { product });
    return result?.listings || [];
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
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

function siteDomain(site) {
  try {
    const domain = new URL(site.searchUrl || site.baseUrl).hostname.replace(/^www\./, '').toLowerCase();
    const expected = [
      { name: /mercado\s*livre/i, domain: 'mercadolivre.com.br' },
      { name: /amazon/i, domain: 'amazon.com.br' },
      { name: /shopee/i, domain: 'shopee.com.br' }
    ].find((rule) => rule.name.test(site.name || ''));
    return expected && !domain.endsWith(expected.domain) ? '' : domain;
  } catch { return ''; }
}

function listingMatchesSites(listing, sites) {
  if (!sites.length) return true;
  try {
    const hostname = new URL(listing.link).hostname.replace(/^www\./, '').toLowerCase();
    return sites.some((site) => { const domain = siteDomain(site); return domain && (hostname === domain || hostname.endsWith(`.${domain}`)); });
  } catch { return false; }
}

async function runSearch(port, message) {
  const requestId = message.requestId;
  const products = Array.isArray(message.products) ? message.products.slice(0, 5) : [];
  const sites = Array.isArray(message.sites) ? message.sites.slice(0, 20) : [];
  if (!products.length) throw new Error('Nenhum produto válido foi enviado à extensão.');
  const ownBrands = message.config?.ownBrands;
  if (Array.isArray(ownBrands) && ownBrands.length) ProductMatcher.addOwnBrands(ownBrands);

  const totalSteps = products.length * 5;
  let completedSteps = 0;
  const results = [];

  for (const product of products) {
    const listings = [];
    const sources = [];
    const label = product.name || product.ean;
    const semantic = ProductMatcher.buildSemanticQuery(product);
    const domains = [...new Set(sites.map(siteDomain).filter(Boolean))];
    const siteClause = domains.length ? `(${domains.map((domain) => `site:${domain}`).join(' OR ')})` : '';
    const steps = sites.length ? [
      { name: 'Sites por EAN', query: `${product.ean} ${siteClause}`, mode: 'web', exactEan: true },
      { name: 'Sites por nome', query: `"${product.name || product.ean}" ${siteClause}`, mode: 'web' },
      { name: 'Sites por semântica', query: `${semantic || product.name || product.ean} ${siteClause}`, mode: 'web' },
      { name: 'Descoberta Google Shopping', query: product.name || product.ean, mode: 'shopping', discovery: true }
    ] : [
      { name: 'Google EAN', query: product.ean, mode: 'web', exactEan: true },
      { name: 'Google Nome', query: product.name || product.ean, mode: 'web' },
      { name: 'Google Semântico', query: semantic || product.name || product.ean, mode: 'web' },
      { name: 'Google Shopping', query: product.name || product.ean, mode: 'shopping' }
    ];

    let googleBlocked = false;
    for (const step of steps) {
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `Pesquisando ${label} em ${step.name}…`
      });
      if (googleBlocked) {
        sources.push({ name: step.name, status: 'skipped', count: 0, error: 'Google bloqueado por CAPTCHA' });
        completedSteps += 1;
        continue;
      }
      try {
        const found = step.query
          ? await searchGoogle(step.query, step.exactEan ? { ...product, searchMode: 'ean' } : product, step.mode)
          : [];
        const selected = sites.length
          ? found.filter((listing) => step.discovery || listingMatchesSites(listing, sites))
            .map((listing) => step.discovery && !listingMatchesSites(listing, sites) ? { ...listing, discoveryCandidate: true } : listing)
          : found;
        listings.push(...selected);
        sources.push({ name: step.name, status: 'ok', count: selected.length });
      } catch (error) {
        sources.push({ name: step.name, status: 'error', count: 0, error: error.message });
        if (/CAPTCHA|verificação/i.test(error.message)) googleBlocked = true;
      }
      completedSteps += 1;
    }

    const mercadoLivreEnabled = !sites.length || sites.some((site) => /mercado\s*livre/i.test(site.name) || /mercadolivre\.com\.br$/.test(siteDomain(site)));
    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Pesquisando ${label} no Mercado Livre…`
    });
    if (mercadoLivreEnabled) {
      try {
        const found = await searchMercadoLivre(product);
        listings.push(...found);
        sources.push({ name: 'Mercado Livre', status: 'ok', count: found.length });
      } catch (error) {
        sources.push({ name: 'Mercado Livre', status: 'error', count: 0, error: error.message });
      }
    } else {
      sources.push({ name: 'Mercado Livre', status: 'skipped', count: 0 });
    }
    completedSteps += 1;
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
