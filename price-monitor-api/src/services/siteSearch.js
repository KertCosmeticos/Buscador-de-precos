'use strict';

const axios = require('axios');
const { inspectProductPage } = require('./serpApi');

const httpClient = axios.create({
  timeout: 10000,
  maxContentLength: 8 * 1024 * 1024,
  responseType: 'text',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  }
});

function numberFromPrice(value) {
  if (Number.isFinite(value)) return Number(value);
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

function slugTitle(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return (parts.pop() || '').replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

// Monta a URL de busca do site substituindo placeholder ou ajustando o query param existente.
function buildSearchUrl(site, term) {
  const raw = site.searchUrl || '';
  if (!raw || site.requiresPlaywright) return '';
  if (/{(query|term)}/i.test(raw)) return raw.replace(/{(query|term)}/i, encodeURIComponent(term));
  try {
    const url = new URL(raw);
    const knownKey = ['q', 'query', 'busca', 'search', 'keyword', 'pesquisa', 's', 'termo']
      .find((k) => url.searchParams.has(k)) || 'q';
    url.searchParams.set(knownKey, term);
    return url.href;
  } catch { return ''; }
}

async function fetchHtml(url) {
  try {
    const response = await httpClient.get(url);
    return { html: String(response.data || ''), finalUrl: response.request?.res?.responseUrl || url };
  } catch { return null; }
}

function siteHostname(site) {
  try { return new URL(site.baseUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Extrai listings de JSON-LD numa página de resultados de busca (ItemList ou Products).
function listingsFromJsonLd(html, pageUrl) {
  const results = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(match[1].trim());
      const nodes = Array.isArray(raw) ? raw : [raw];
      for (const node of nodes) {
        const types = [].concat(node['@type'] || []).map((t) => String(t).toLowerCase());
        if (types.includes('itemlist')) {
          for (const el of (node.itemListElement || [])) {
            const item = el.item || el;
            const iTypes = [].concat(item['@type'] || []).map((t) => String(t).toLowerCase());
            if (!iTypes.includes('product')) continue;
            const price = numberFromPrice(item.offers?.price ?? item.offers?.lowPrice);
            const link = absoluteUrl(item.url || '', pageUrl);
            if (link) results.push({ title: String(item.name || '').trim(), price, link });
          }
        }
        if (types.includes('product')) {
          const price = numberFromPrice(node.offers?.price ?? node.offers?.lowPrice);
          const link = absoluteUrl(node.url || '', pageUrl);
          if (link) results.push({ title: String(node.name || '').trim(), price, link });
        }
      }
    } catch { /* JSON-LD inválido */ }
  }
  return results;
}

// Caminhos que não são páginas de produto — excluídos da extração de links.
const SKIP_PATHS = /\/(cart|carrinho|login|conta|account|wishlist|checkout|contato|contact|sobre|about|blog|quem-somos|faq|politica|politicas|termos|busca|search|buscar|resultado|resultados|categoria|categorias|colecao|colecoes|marca|marcas|novidades|lancamentos)\b/i;

// Extrai links de produto da HTML da página de resultados de busca.
function extractProductLinks(html, pageUrl, baseUrl) {
  let hostname;
  try { hostname = new URL(baseUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return []; }
  const seen = new Set();
  const links = [];
  for (const match of String(html).matchAll(/href=["']([^"'#][^"']*)["']/gi)) {
    const full = absoluteUrl(match[1], pageUrl);
    if (!full) continue;
    try {
      const url = new URL(full);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (url.hostname.replace(/^www\./, '').toLowerCase() !== hostname) continue;
      if (SKIP_PATHS.test(url.pathname)) continue;
      if (url.pathname.split('/').filter(Boolean).length < 1) continue;
      const key = url.origin + url.pathname;
      if (!seen.has(key)) { seen.add(key); links.push(key); }
    } catch { /* skip */ }
  }
  return links.slice(0, 10);
}

async function searchSiteWithTerm(site, term) {
  const searchUrl = buildSearchUrl(site, term);
  if (!searchUrl) return [];
  const fetched = await fetchHtml(searchUrl);
  if (!fetched) return [];

  const { html, finalUrl } = fetched;
  const marketplace = siteHostname(site);

  // Tenta JSON-LD da página de resultados (VTEX, Magento, WooCommerce costumam publicar)
  const jsonLdResults = listingsFromJsonLd(html, finalUrl);
  const withPrice = jsonLdResults.filter((r) => Number.isFinite(r.price));
  if (withPrice.length >= 2) {
    return withPrice.slice(0, 8).map((r) => ({ ...r, marketplace, seller: marketplace, condition: 'new', freeShipping: false }));
  }

  // Fallback: visita links de produto encontrados na página
  const jsonLdLinks = jsonLdResults.filter((r) => !Number.isFinite(r.price)).map((r) => r.link);
  const htmlLinks = extractProductLinks(html, finalUrl, site.baseUrl);
  const candidates = [...new Set([...jsonLdLinks, ...htmlLinks])].slice(0, 6);
  if (!candidates.length) return [];

  const visited = await Promise.allSettled(
    candidates.map(async (link) => {
      const page = await inspectProductPage(link);
      if (!page || !Number.isFinite(page.price)) return null;
      return {
        title: page.title || slugTitle(link),
        price: page.price,
        link: page.directLink || link,
        marketplace,
        seller: marketplace,
        condition: 'new',
        freeShipping: false
      };
    })
  );
  return visited.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
}

async function searchSite(site, ean, terms) {
  // Camada 1a: EAN — identidade absoluta, mais precisa
  if (site.acceptsEan && ean) {
    const results = await searchSiteWithTerm(site, ean);
    if (results.length) return results;
  }

  if (!site.acceptsName) return [];

  // Camada 1b: termos de nome em ordem decrescente de especificidade
  // medium: nome sem volume, aliases, goodTerms aprendidos
  // wide: marca+tipo+família, marca+família (fallback de descoberta)
  const nameTerms = [
    ...(terms.medium || []).slice(0, 3),
    ...(terms.wide || []).slice(0, 2),
  ].filter(Boolean);

  for (const term of nameTerms) {
    // eslint-disable-next-line no-await-in-loop
    const results = await searchSiteWithTerm(site, term);
    if (results.length) return results;
  }

  return [];
}

// Busca em todos os sites cadastrados em paralelo e combina os resultados.
async function searchRegisteredSites(ean, terms, sites = []) {
  const active = sites.filter((s) => !s.requiresPlaywright && s.active !== false);
  if (!active.length) return [];
  const results = await Promise.allSettled(active.map((site) => searchSite(site, ean, terms)));
  return results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
}

module.exports = { searchRegisteredSites };
