function storeCleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dispatchInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function discoverSearch(query) {
  const selectors = [
    'input[type="search"]', 'input[name="q"]', 'input[name="query"]',
    'input[name="search"]', 'input[name="term"]', 'input[name="text"]',
    'input[placeholder*="buscar" i]', 'input[placeholder*="pesquisar" i]',
    'input[aria-label*="buscar" i]', 'input[aria-label*="pesquisar" i]'
  ];
  const input = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!input) return { found: false };
  const form = input.closest('form');
  if (form && String(form.method || 'get').toLowerCase() === 'get') {
    const url = new URL(form.action || location.href, location.href);
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
      if (typeof value === 'string' && key !== input.name && value) url.searchParams.set(key, value);
    }
    url.searchParams.set(input.name || 'q', query);
    return { found: true, url: url.href };
  }
  dispatchInput(input, query);
  const submit = form?.querySelector('button[type="submit"], input[type="submit"]')
    || input.parentElement?.querySelector('button');
  setTimeout(() => {
    if (submit) submit.click();
    else if (form?.requestSubmit) form.requestSubmit();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }, 50);
  return { found: true, submitted: true };
}

function parseStorePrice(value) {
  const text = storeCleanText(value);
  const labeled = [...text.matchAll(/R\$\s*([\d.]+)(?:,(\d{2}))?/gi)];
  for (const match of labeled) {
    const before = text.slice(Math.max(0, match.index - 35), match.index);
    if (/(?:de|parcela|frete|economize|desconto)[^R$]{0,18}$/i.test(before)) continue;
    const price = Number(`${match[1].replaceAll('.', '')}.${match[2] || '00'}`);
    if (Number.isFinite(price) && price > 0.5) return price;
  }
  return null;
}

function normalizeStoreLink(value) {
  try {
    const url = new URL(value, location.href);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag|source|campaign)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

function isProductLink(anchor) {
  try {
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return false;
    if (/\/(?:busca|search|pesquisa|categoria|category|cart|carrinho|login|account)(?:[/?#]|$)/i.test(url.pathname)) return false;
    return url.pathname !== '/' && storeCleanText(anchor.textContent || anchor.getAttribute('aria-label')).length >= 4;
  } catch { return false; }
}

function cardAroundPrice(priceElement) {
  let element = priceElement;
  for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
    const text = storeCleanText(element.innerText || '');
    if (text.length > 1800) break;
    const links = [...element.querySelectorAll('a[href]')].filter(isProductLink);
    const hasProductText = !!element.querySelector('h1, h2, h3, h4, [class*="product-name" i], [class*="product-title" i], img[alt]');
    if (links.length && hasProductText && /R\$\s*[\d.]+(?:,\d{2})?/i.test(text)) return { element, links };
  }
  return null;
}

function extractStoreListings(product, store) {
  const listings = new Map();
  const priceSelectors = [
    '[itemprop="price"]', '[data-testid*="price" i]', '[class*="selling-price" i]',
    '[class*="best-price" i]', '[class*="sale-price" i]', '[class*="price" i]'
  ].join(',');
  document.querySelectorAll(priceSelectors).forEach((priceElement) => {
    const card = cardAroundPrice(priceElement);
    if (!card) return;
    const price = parseStorePrice(priceElement.innerText || priceElement.textContent)
      || parseStorePrice(card.element.innerText || '');
    if (!Number.isFinite(price)) return;
    for (const anchor of card.links) {
      const link = normalizeStoreLink(anchor.href);
      if (!link || listings.has(link)) continue;
      const candidates = [
        ...card.element.querySelectorAll('h1, h2, h3, h4, [class*="product-name" i], [class*="product-title" i]'),
        ...card.element.querySelectorAll('img[alt]'), anchor
      ].map((element) => storeCleanText(
        element.tagName === 'IMG' ? element.getAttribute('alt') : element.textContent || element.getAttribute('aria-label')
      )).filter((candidate) => candidate.length >= 5
        && /[a-záàâãéêíóôõúç]/i.test(candidate)
        && !/^R\$|^(?:comprar|ver produto|saiba mais)$/i.test(candidate));
      const title = candidates.find((candidate) => ProductMatcher.matchesOffer(
        `${candidate} ${link}`, link, { ...product, searchMode: undefined }
      ).relevant) || '';
      if (!title) continue;
      const evidence = `${title} ${link} ${storeCleanText(card.element.innerText || '')}`;
      if (!ProductMatcher.matchesOffer(evidence, link, { ...product, searchMode: undefined }).relevant) continue;
      if (!ProductMatcher.linkMatchesProduct(link, { ...product, searchMode: undefined })) continue;
      listings.set(link, {
        title, price, seller: store.name, marketplace: store.name, link,
        soldQuantity: null, condition: 'new',
        freeShipping: /frete\s+gr[aá]tis/i.test(card.element.innerText || '')
      });
      break;
    }
  });
  return [...listings.values()];
}

function listingFromCatalogProduct(entry, product, store, platform) {
  const title = storeCleanText(entry.title || entry.productName || '');
  const link = normalizeStoreLink(entry.link || entry.url || '');
  const price = Number(entry.price);
  if (!title || !link || !Number.isFinite(price) || price <= 0) return null;
  const candidate = { ...product, searchMode: undefined };
  if (!ProductMatcher.matchesOffer(`${title} ${link}`, link, candidate).relevant) return null;
  if (!ProductMatcher.linkMatchesProduct(link, candidate)) return null;
  return {
    title, price, seller: store.name, marketplace: store.name, link,
    soldQuantity: null, condition: 'new', freeShipping: false, sourcePlatform: platform
  };
}

async function queryVtex(query, product, store) {
  const response = await fetch(`/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`, {
    credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000)
  });
  if (!response.ok || !String(response.headers.get('content-type')).includes('json')) return { supported: false, listings: [] };
  const products = await response.json();
  if (!Array.isArray(products)) return { supported: false, listings: [] };
  const listings = [];
  products.forEach((entry) => {
    const offers = (entry.items || []).flatMap((item) => item.sellers || [])
      .map((seller) => seller.commertialOffer || {})
      .filter((offer) => Number(offer.Price) > 0 && Number(offer.AvailableQuantity) > 0);
    const lowest = offers.sort((a, b) => Number(a.Price) - Number(b.Price))[0];
    if (!lowest) return;
    const listing = listingFromCatalogProduct({
      title: entry.productName, link: entry.link, price: Number(lowest.Price)
    }, product, store, 'VTEX');
    if (listing) listings.push(listing);
  });
  return { supported: true, listings };
}

async function queryShopify(query, product, store) {
  const url = `/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`;
  const response = await fetch(url, {
    credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000)
  });
  if (!response.ok || !String(response.headers.get('content-type')).includes('json')) return { supported: false, listings: [] };
  const data = await response.json();
  const products = data?.resources?.results?.products;
  if (!Array.isArray(products)) return { supported: false, listings: [] };
  const listings = products.map((entry) => listingFromCatalogProduct({
    title: entry.title, link: entry.url,
    price: Number(entry.price) || parseStorePrice(String(entry.price || ''))
  }, product, store, 'Shopify')).filter(Boolean);
  return { supported: true, listings };
}

async function queryStoreCatalog(queries, product, store) {
  let platformSupported = false;
  for (const query of queries.filter(Boolean)) {
    for (const connector of [queryVtex, queryShopify]) {
      try {
        const result = await connector(query, product, store);
        platformSupported ||= result.supported;
        if (result.listings.length) return { supported: true, listings: result.listings };
      } catch { /* tenta a próxima plataforma ou a busca visual */ }
    }
  }
  return { supported: platformSupported, listings: [] };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'QUERY_STORE_CATALOG') {
      queryStoreCatalog(message.queries || [], message.product || {}, message.store || {})
        .then(sendResponse).catch((error) => sendResponse({ supported: false, listings: [], error: error.message }));
      return true;
    }
    if (message.type === 'DISCOVER_STORE_SEARCH') {
      sendResponse(discoverSearch(String(message.query || '')));
      return;
    }
    if (message.type === 'EXTRACT_STORE_RESULTS') {
      const body = document.body?.innerText || '';
      const blocked = /access denied|verifique se voc[eê] [eé] humano|captcha|robot or human|acesso negado/i.test(body);
      sendResponse({ blocked, listings: blocked ? [] : extractStoreListings(message.product || {}, message.store || {}) });
    }
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = { parseStorePrice };
}
