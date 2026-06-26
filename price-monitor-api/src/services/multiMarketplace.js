const { searchByEan } = require('./mercadoLivre');
const { searchGoogleShopping, searchGoogleWebMedium, searchGoogleWebWide } = require('./serpApi');
const { searchRegisteredSites } = require('./siteSearch');
const { searchBingWeb } = require('./bingSearch');
const { searchAggregators } = require('./buscapeSearch');

function deduplicate(listings) {
  const results = [];
  const positions = new Map();
  listings.forEach((item) => {
    let normalizedLink = item.link || '';
    if (normalizedLink) {
      try {
        const url = new URL(normalizedLink);
        [...url.searchParams.keys()].forEach((key) => {
          if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag)$/i.test(key)) url.searchParams.delete(key);
        });
        url.hash = '';
        normalizedLink = url.href.replace(/\/$/, '');
      } catch {
        // Mantém o link original quando a fonte retorna um endereço fora do padrão.
      }
    }
    const normalized = { ...item, link: normalizedLink };
    const key = normalizedLink || `${item.marketplace}|${item.title}|${item.price}`;
    if (!positions.has(key)) {
      positions.set(key, results.length);
      results.push(normalized);
      return;
    }
    const index = positions.get(key);
    if (Number.isFinite(normalized.price)
      && (!Number.isFinite(results[index].price) || normalized.price < results[index].price)) {
      results[index] = normalized;
    }
  });
  return results;
}

function siteDomain(site) {
  try { return new URL(site.searchUrl || site.baseUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function searchableSiteDomain(site) {
  const domain = siteDomain(site);
  const expected = [
    { name: /mercado\s*livre/i, domain: 'mercadolivre.com.br' },
    { name: /amazon/i, domain: 'amazon.com.br' },
    { name: /shopee/i, domain: 'shopee.com.br' }
  ].find((rule) => rule.name.test(site.name || ''));
  return expected && !domain.endsWith(expected.domain) ? '' : domain;
}

// terms pode ser string (legado) ou { exact, medium, wide } (novo)
async function searchAllMarketplaces(ean, terms, sites = []) {
  const layered = (!terms || typeof terms === 'string')
    ? { exact: [terms].filter(Boolean), medium: [], wide: [] }
    : terms;

  const productName = (layered.exact || []).find((t) => t !== ean) || '';
  const domains = [...new Set(sites.map(searchableSiteDomain).filter(Boolean))];
  const mercadoLivreSelected = !sites.length
    || sites.some((site) => /mercado\s*livre/i.test(site.name) || /mercadolivre\.com\.br$/.test(siteDomain(site)));

  // queryKey: identifica queries idênticas para deduplicação (R6)
  const qk = (prefix, term, doms = []) => `${prefix}:${term}:${[...doms].sort().join('|')}`;

  const allConnectors = [
    {
      name: 'Mercado Livre',
      enabled: mercadoLivreSelected,
      search: () => searchByEan(ean, productName),
    },
    {
      name: 'Sites cadastrados',
      enabled: sites.length > 0,
      search: () => searchRegisteredSites(ean, layered, sites),
    },
    {
      name: sites.length ? 'Sites selecionados via Google' : 'Google Shopping e Web',
      enabled: Boolean(process.env.SERPAPI_KEY) && (!sites.length || domains.length > 0),
      search: () => searchGoogleShopping(ean, productName, { domains }),
    },
    // Camada média: busca de intenção com termos sem volume/abreviação
    ...(layered.medium || []).slice(0, 3).map((term, i) => ({
      name: `Google Médio ${i + 1}`,
      queryKey: qk('gm', term, domains),
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term),
      search: () => searchGoogleWebMedium(term, domains),
    })),
    // Camada ampla: descoberta de sites — todos marcados como discoveryCandidate
    ...(layered.wide || []).slice(0, 3).map((term, i) => ({
      name: `Google Amplo ${i + 1}`,
      queryKey: qk('gw', term),
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term),
      search: () => searchGoogleWebWide(term),
    })),
    // Camada EAN+sites: 1 query consolidada para todos os domínios (era N calls separadas)
    ...(ean && domains.length ? [{
      name: 'Google EAN+sites',
      queryKey: qk('gm', ean, domains.slice(0, 8)),
      enabled: Boolean(process.env.SERPAPI_KEY),
      search: () => searchGoogleWebMedium(ean, domains.slice(0, 8)),
    }] : []),
    // Camada nome+sites: nome sem volume em todos os domínios — 1 query consolidada
    ...((layered.medium || []).slice(0, 1).map((term) => ({
      name: 'Google Nome+sites',
      queryKey: qk('gm', term, domains.slice(0, 8)),
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term) && domains.length > 0,
      search: () => searchGoogleWebMedium(term, domains.slice(0, 8)),
    }))),
    // Camada alias+sites: 1 call por alias com todos os domínios (era alias×domain calls)
    ...(layered.siteAliases || []).slice(0, 2).map((alias, i) => ({
      name: `Google Alias ${i + 1}+sites`,
      queryKey: qk('gm', alias, domains.slice(0, 8)),
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(alias) && domains.length > 0,
      search: () => searchGoogleWebMedium(alias, domains.slice(0, 8)),
    })),
    // Camada wide+sites: termo amplo em todos os domínios — 1 query consolidada
    ...((layered.wide || []).slice(0, 1).map((term) => ({
      name: 'Google Wide+sites',
      queryKey: qk('gm', term, domains.slice(0, 8)),
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term) && domains.length > 0,
      search: () => searchGoogleWebMedium(term, domains.slice(0, 8)),
    }))),
    // Bing Web: alternativa ao Google para descoberta, sem CAPTCHA (usa BING_API_KEY)
    {
      name: 'Bing Web',
      queryKey: qk('bing', productName || ean, domains.slice(0, 6)),
      enabled: Boolean(process.env.BING_API_KEY),
      search: () => searchBingWeb(productName || ean, domains.slice(0, 6)),
    },
    // Buscapé/Zoom: agregadores de preço brasileiros — scraping sem chave de API
    {
      name: 'Buscapé/Zoom',
      queryKey: `buscape:${ean}`,
      enabled: Boolean(ean),
      search: () => searchAggregators(ean),
    },
  ];

  // Deduplica connectors com a mesma query antes de executar (R6)
  const seenKeys = new Set();
  const connectors = allConnectors
    .filter((c) => c.enabled)
    .filter((c) => {
      if (!c.queryKey) return true;
      if (seenKeys.has(c.queryKey)) return false;
      seenKeys.add(c.queryKey);
      return true;
    });

  const settled = await Promise.allSettled(connectors.map((connector) => connector.search()));
  const sources = settled.map((result, index) => ({
    name: connectors[index].name,
    status: result.status === 'fulfilled' ? 'ok' : 'error',
    count: result.status === 'fulfilled' ? result.value.length : 0,
    error: result.status === 'rejected' ? result.reason.message : undefined,
  }));
  const listings = deduplicate(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []));

  if (!listings.length && settled.every((result) => result.status === 'rejected')) {
    const error = new Error('Nenhuma fonte de pesquisa respondeu. Tente novamente mais tarde.');
    error.status = 502;
    error.sources = sources;
    throw error;
  }
  return { listings, sources };
}

module.exports = { searchAllMarketplaces, deduplicate, siteDomain, searchableSiteDomain };
