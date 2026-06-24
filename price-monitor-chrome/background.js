importScripts('product-matcher.js');

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
  let injected = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type, ...payload });
    } catch (error) {
      lastError = error;
      if (!injected && /Receiving end does not exist|Could not establish connection/i.test(error.message || '')) {
        injected = await injectExtractor(tabId);
      }
      await delay(700);
    }
  }
  throw lastError || new Error('Não foi possível ler a página de pesquisa.');
}

async function injectExtractor(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url || '');
    let files = [];
    if (/(^|\.)google\.com(?:\.br)?$/.test(url.hostname) && url.pathname.startsWith('/search')) {
      files = ['product-matcher.js', 'google-extractor.js'];
    } else if (/(^|\.)mercadolivre\.com\.br$/.test(url.hostname)) {
      files = ['product-matcher.js', 'mercadolivre-extractor.js'];
    } else if (url.protocol === 'https:' || url.protocol === 'http:') {
      files = ['product-matcher.js', 'product-page-extractor.js'];
    }
    if (!files.length) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files });
    await delay(300);
    return true;
  } catch {
    return false;
  }
}

async function inspectProductPage(listing, product) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  try {
    await navigateTab(tab.id, listing.link);
    await delay(1400);
    const result = await sendToTab(tab.id, 'EXTRACT_PRODUCT_PAGE', { product });
    if (!Number.isFinite(result?.price)) return null;
    return {
      ...listing,
      title: result.title || listing.title,
      link: result.link || listing.link,
      price: result.price,
      needsPriceInspection: false
    };
  } catch {
    return null;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function enrichMissingPrices(listings, product, limit = 3) {
  const priced = listings.filter((listing) => Number.isFinite(listing.price));
  // Se o Google já forneceu preços, não abrimos páginas adicionais.
  if (priced.length) return priced;
  const candidates = listings.filter((listing) => !Number.isFinite(listing.price)).slice(0, limit);
  const inspected = await Promise.all(candidates.map((candidate) => inspectProductPage(candidate, product)));
  return inspected.filter(Boolean);
}

async function searchGoogle(query, product, mode = 'web') {
  const parameters = new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'br', num: '30' });
  if (mode === 'shopping') parameters.set('tbm', 'shop');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  let keepOpen = false;
  try {
    await navigateTab(tab.id, `https://www.google.com/search?${parameters}`);
    await delay(mode === 'shopping' ? 2600 : 1600);
    const result = await sendToTab(tab.id, 'EXTRACT_GOOGLE_RESULTS', { product });
    if (result?.captcha) {
      keepOpen = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('O Google solicitou verificação. Resolva o CAPTCHA na aba aberta e repita a busca.');
    }
    return enrichMissingPrices(result?.listings || [], product, 2);
  } finally {
    if (!keepOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function mercadoLivreUrl(query) {
  const slug = String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://lista.mercadolivre.com.br/${slug}`;
}

async function searchMercadoLivre(product) {
  async function searchQuery(query) {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    try {
      await navigateTab(tab.id, mercadoLivreUrl(query));
      for (const wait of [1600, 1600, 2000]) {
        await delay(wait);
        const result = await sendToTab(tab.id, 'EXTRACT_ML_RESULTS', { product });
        if (result?.listings?.length) return result.listings;
      }
      return [];
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  const descriptiveQuery = ProductMatcher.buildMarketplaceQuery(product) || product.name;
  const queries = [...new Set([descriptiveQuery, product.ean].filter(Boolean))];
  const groups = await Promise.all(queries.map(searchQuery));
  return deduplicate(groups.flat());
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

/*
 * As consultas externas usam concorrência baixa de propósito: três abas mantêm
 * a busca rápida sem criar uma rajada grande o bastante para provocar CAPTCHA.
 */
async function searchGoogleSteps(steps, product, sites, onComplete) {
  return mapWithConcurrency(steps, 3, async (step) => {
    try {
      const found = await searchGoogle(step.query, step.exactEan ? { ...product, searchMode: 'ean' } : product, step.mode);
      const selected = sites.length
        ? found.filter((listing) => step.discovery || listingMatchesSites(listing, sites))
          .map((listing) => step.discovery && !listingMatchesSites(listing, sites) ? { ...listing, discoveryCandidate: true } : listing)
        : found;
      return { source: { name: step.name, status: 'ok', count: selected.length }, listings: selected };
    } catch (error) {
      if (/CAPTCHA|verificação/i.test(error.message)) throw error;
      return { source: { name: step.name, status: 'error', count: 0, error: error.message }, listings: [] };
    } finally {
      onComplete(step);
    }
  });
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

function googleSteps(product, sites) {
  const descriptive = ProductMatcher.buildMarketplaceQuery(product) || product.name || product.ean;
  const semantic = ProductMatcher.buildSemanticQuery(product);
  if (!sites.length) return [
    { name: 'Google por EAN', query: product.ean, mode: 'web', exactEan: true },
    { name: 'Google por nome', query: product.name || product.ean, mode: 'web' },
    { name: 'Google semântico', query: semantic || descriptive, mode: 'web' },
    { name: 'Google Shopping', query: descriptive, mode: 'shopping', discovery: true }
  ];
  const registered = [];
  const seen = new Set();
  sites.forEach((site) => {
    const domain = siteDomain(site);
    if (!domain || seen.has(domain)) return;
    seen.add(domain);
    registered.push({ name: site.name || domain, query: `${descriptive} site:${domain}`, mode: 'web' });
  });
  return [
    ...registered,
    { name: 'Descoberta na Web', query: descriptive, mode: 'web', discovery: true },
    { name: 'Descoberta Google Shopping', query: descriptive, mode: 'shopping', discovery: true }
  ];
}

async function runSearch(port, message) {
  const requestId = message.requestId;
  const products = Array.isArray(message.products) ? message.products.slice(0, 5) : [];
  const sites = Array.isArray(message.sites) ? message.sites.slice(0, 20) : [];
  if (!products.length) throw new Error('Nenhum produto válido foi enviado à extensão.');
  const ownBrands = message.config?.ownBrands;
  if (Array.isArray(ownBrands) && ownBrands.length) ProductMatcher.addOwnBrands(ownBrands);

  const totalSteps = products.reduce((total, product) => total + googleSteps(product, sites).length + 1, 0);
  let completedSteps = 0;
  const results = [];

  for (const product of products) {
    const listings = [];
    const sources = [];
    const label = product.name || product.ean;
    const steps = googleSteps(product, sites);

    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Pesquisando ${label} em ${steps.length} fonte(s)…`
    });
    const stepResults = await searchGoogleSteps(steps, product, sites, (step) => {
      completedSteps += 1;
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `${step.name} concluído para ${label}…`
      });
    });
    stepResults.forEach((result) => {
      listings.push(...result.listings);
      sources.push(result.source);
    });

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
