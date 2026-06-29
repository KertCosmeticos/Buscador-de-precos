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

// Cache em memória de sites com falhas consecutivas (anti-bot, timeout, sem produtos).
// Após FAIL_THRESHOLD tentativas em branco, o site fica bloqueado por FAIL_TTL_MS.
const siteFailCache = new Map();
const FAIL_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const FAIL_THRESHOLD = 3;

function siteKey(site) { return String(site._id || site.name || site.baseUrl || ''); }

function isSiteBlocked(site) {
  const entry = siteFailCache.get(siteKey(site));
  if (!entry?.until) return false;
  if (Date.now() > entry.until) { siteFailCache.delete(siteKey(site)); return false; }
  return true;
}

function recordSiteResult(site, found) {
  const key = siteKey(site);
  if (found) { siteFailCache.delete(key); return; }
  const entry = siteFailCache.get(key) || { failCount: 0 };
  entry.failCount += 1;
  if (entry.failCount >= FAIL_THRESHOLD) entry.until = Date.now() + FAIL_TTL_MS;
  siteFailCache.set(key, entry);
}

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
// Suporta {termo}, {term} e {query} como placeholder — substitui todas as ocorrências (ex: VTEX /{termo}?_q={termo}&map=ft).
function buildSearchUrl(site, term) {
  const raw = site.searchUrl || '';
  if (!raw || site.requiresPlaywright) return '';
  if (/{(query|term|termo)}/i.test(raw)) return raw.replace(/{(query|term|termo)}/gi, encodeURIComponent(term));
  try {
    const url = new URL(raw);
    const knownKey = ['q', '_q', 'query', 'busca', 'search', 'keyword', 'pesquisa', 's', 'termo', 'palavra_busca', 'w']
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
  // Ordena por comprimento do slug final — slugs longos são páginas de produto,
  // slugs curtos (ex: "cabelos", "shampoo") são categorias de navegação.
  links.sort((a, b) => (b.split('/').pop() || '').length - (a.split('/').pop() || '').length);
  return links.slice(0, 30);
}

// Extrai listings de um array de produtos retornado pela API VTEX Legacy.
function extractVtexProducts(data, origin) {
  if (!Array.isArray(data) || !data.length) return [];
  return data.flatMap((product) => {
    const sku = (product.items || []).find((i) => i.sellers?.length) || product.items?.[0];
    if (!sku) return [];
    const price = numberFromPrice(sku.sellers?.[0]?.commertialOffer?.Price);
    if (!Number.isFinite(price)) return [];
    const link = absoluteUrl(product.link || '', origin);
    if (!link) return [];
    return [{ title: String(product.productName || product.name || sku.name || '').trim(), price, link }];
  });
}

// Busca produtos via API de catálogo VTEX público.
// Se o termo for um EAN (8-14 dígitos) usa fq=alternateId para busca exata por código de barras,
// evitando que a busca full-text retorne produtos não relacionados.
async function searchVtexCatalog(origin, term) {
  const isEan = /^\d{8,14}$/.test(String(term).trim());
  try {
    if (isEan) {
      const res = await httpClient.get(`${origin}/api/catalog_system/pub/products/search`, {
        params: { fq: `alternateId:${String(term).trim()}`, _from: 0, _to: 4 },
      });
      const byEan = extractVtexProducts(res.data, origin);
      if (byEan.length) return byEan;
    }
    const res = await httpClient.get(`${origin}/api/catalog_system/pub/products/search`, {
      params: { ft: term, _from: 0, _to: 4 },
    });
    return extractVtexProducts(res.data, origin);
  } catch { return []; }
}

async function searchSiteWithTerm(site, term) {
  const searchUrl = buildSearchUrl(site, term);
  if (!searchUrl) return [];
  const marketplace = siteHostname(site);

  const fetched = await fetchHtml(searchUrl);

  // Site bloqueou a página de busca (anti-bot, Cloudflare, timeout) → tenta VTEX API diretamente.
  // A API /pub/ é pública e frequentemente acessível mesmo quando o HTML está protegido.
  if (!fetched) {
    try {
      const origin = new URL(searchUrl).origin;
      const vtexResults = await searchVtexCatalog(origin, term);
      return vtexResults.map((r) => ({ ...r, marketplace, seller: marketplace, condition: 'new', freeShipping: false }));
    } catch { return []; }
  }

  const { html, finalUrl } = fetched;

  // Tenta JSON-LD da página de resultados (VTEX, Magento, WooCommerce costumam publicar)
  const jsonLdResults = listingsFromJsonLd(html, finalUrl);
  const withPrice = jsonLdResults.filter((r) => Number.isFinite(r.price));
  if (withPrice.length >= 1) {
    return withPrice.slice(0, 8).map((r) => ({ ...r, marketplace, seller: marketplace, condition: 'new', freeShipping: false }));
  }

  // Fallback VTEX: página de busca é React SPA (__RUNTIME__) — usa API de catálogo público
  if (/\b__RUNTIME__\b/.test(html.slice(0, 3000))) {
    try {
      const origin = new URL(searchUrl).origin;
      const vtexResults = await searchVtexCatalog(origin, term);
      if (vtexResults.length) {
        return vtexResults.map((r) => ({ ...r, marketplace, seller: marketplace, condition: 'new', freeShipping: false }));
      }
    } catch { /* ignora — continua para fallback HTML */ }
  }

  // Fallback: visita links de produto encontrados na página
  const jsonLdLinks = jsonLdResults.filter((r) => !Number.isFinite(r.price)).map((r) => r.link);
  const htmlLinks = extractProductLinks(html, finalUrl, site.baseUrl);
  const candidates = [...new Set([...jsonLdLinks, ...htmlLinks])].slice(0, 12);
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
    if (results.length) { recordSiteResult(site, true); return results; }
  }

  if (!site.acceptsName) { recordSiteResult(site, false); return []; }

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
    if (results.length) { recordSiteResult(site, true); return results; }
  }

  recordSiteResult(site, false);
  return [];
}

// Busca em todos os sites cadastrados em paralelo e combina os resultados.
async function searchRegisteredSites(ean, terms, sites = []) {
  const active = sites.filter((s) => !s.requiresPlaywright && s.active !== false && !isSiteBlocked(s));
  if (!active.length) return [];
  const results = await Promise.allSettled(active.map((site) => searchSite(site, ean, terms)));
  return results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
}

module.exports = { searchRegisteredSites };
