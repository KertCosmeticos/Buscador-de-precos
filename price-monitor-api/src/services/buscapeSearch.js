'use strict';

const axios = require('axios');

const httpClient = axios.create({
  timeout: 10000,
  maxContentLength: 6 * 1024 * 1024,
  responseType: 'text',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    Accept: 'text/html,*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
});

function numberFromPrice(value) {
  const normalized = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const price = Number.parseFloat(normalized);
  return Number.isFinite(price) ? price : null;
}

function absoluteUrl(value, base) {
  if (!value) return '';
  try { return new URL(value, base).href; } catch { return ''; }
}

// Percorre recursivamente um objeto JSON buscando nós com campos de produto.
function findProductNodes(obj, found = [], depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return found;
  if (Array.isArray(obj)) {
    obj.forEach((item) => findProductNodes(item, found, depth + 1));
  } else {
    const hasPrice = 'price' in obj || 'minPrice' in obj || 'lowestPrice' in obj || 'bestPrice' in obj;
    const hasIdentity = 'name' in obj || 'title' in obj || 'url' in obj || 'link' in obj;
    if (hasPrice && hasIdentity) found.push(obj);
    Object.values(obj).forEach((v) => findProductNodes(v, found, depth + 1));
  }
  return found;
}

// Tenta extrair listings do blob __NEXT_DATA__ (Next.js SSR) ou JSON-LD.
function extractListings(html, baseUrl, marketplace) {
  const listings = [];

  // Tentativa via __NEXT_DATA__ (Zoom e Buscapé usam Next.js com SSR)
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const nodes = findProductNodes(JSON.parse(nextMatch[1]));
      for (const node of nodes) {
        const rawPrice = node.price ?? node.minPrice ?? node.lowestPrice ?? node.bestPrice;
        const price = numberFromPrice(rawPrice);
        const rawUrl = node.url ?? node.link ?? node.productUrl ?? node.href ?? '';
        const link = rawUrl ? absoluteUrl(String(rawUrl), baseUrl) : '';
        if (!Number.isFinite(price) || !link) continue;
        listings.push({
          title: String(node.name || node.title || '').trim(),
          price,
          link,
          marketplace,
          seller: marketplace,
          condition: 'new',
          freeShipping: false,
        });
      }
    } catch { /* JSON inválido — tenta JSON-LD */ }
  }

  if (listings.length) return listings;

  // Fallback: JSON-LD padrão (ItemList ou Product)
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(match[1].trim());
      const nodes = Array.isArray(raw) ? raw : [raw];
      for (const node of nodes) {
        const types = [].concat(node['@type'] || []).map((t) => String(t).toLowerCase());
        const items = types.includes('itemlist')
          ? (node.itemListElement || []).map((el) => el.item || el)
          : types.includes('product') ? [node] : [];
        for (const item of items) {
          const price = numberFromPrice(item.offers?.price ?? item.offers?.lowPrice);
          const link = absoluteUrl(item.url || '', baseUrl);
          if (Number.isFinite(price) && link) {
            listings.push({ title: String(item.name || '').trim(), price, link, marketplace, seller: marketplace, condition: 'new', freeShipping: false });
          }
        }
      }
    } catch { /* JSON-LD inválido */ }
  }

  return listings;
}

async function fetchAndExtract(url, marketplace) {
  try {
    const { data, request } = await httpClient.get(url);
    const finalUrl = request?.res?.responseUrl || url;
    return extractListings(String(data || ''), finalUrl, marketplace);
  } catch { return []; }
}

async function searchZoom(ean) {
  if (!ean) return [];
  return fetchAndExtract(`https://www.zoom.com.br/search?q=${encodeURIComponent(ean)}`, 'zoom.com.br');
}

async function searchBuscape(ean) {
  if (!ean) return [];
  return fetchAndExtract(`https://www.buscape.com.br/search?q=${encodeURIComponent(ean)}`, 'buscape.com.br');
}

// Busca em ambos os agregadores em paralelo e combina os resultados.
async function searchAggregators(ean) {
  if (!ean) return [];
  const results = await Promise.allSettled([searchZoom(ean), searchBuscape(ean)]);
  return results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
}

module.exports = { searchAggregators };
