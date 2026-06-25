const { searchByEan } = require('./mercadoLivre');
const { searchGoogleShopping, searchGoogleWebMedium, searchGoogleWebWide } = require('./serpApi');

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

  const connectors = [
    {
      name: 'Mercado Livre',
      enabled: mercadoLivreSelected,
      search: () => searchByEan(ean, productName),
    },
    {
      name: sites.length ? 'Sites selecionados via Google' : 'Google Shopping e Web',
      enabled: Boolean(process.env.SERPAPI_KEY) && (!sites.length || domains.length > 0),
      search: () => searchGoogleShopping(ean, productName, { domains }),
    },
    // Camada média: busca de intenção com termos sem volume/abreviação
    ...(layered.medium || []).slice(0, 3).map((term, i) => ({
      name: `Google Médio ${i + 1}`,
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term),
      search: () => searchGoogleWebMedium(term, domains),
    })),
    // Camada ampla: descoberta de sites — todos marcados como discoveryCandidate
    ...(layered.wide || []).slice(0, 3).map((term, i) => ({
      name: `Google Amplo ${i + 1}`,
      enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term),
      search: () => searchGoogleWebWide(term),
    })),
    // Camada site+alias: alias buscado individualmente por domínio cadastrado
    ...(layered.siteAliases || []).slice(0, 2).flatMap((alias, i) =>
      domains.slice(0, 5).map((domain) => ({
        name: `Google Alias ${i + 1}:${domain}`,
        enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(alias),
        search: () => searchGoogleWebMedium(alias, [domain]),
      }))
    ),
    // Camada site+wide: termo amplo principal por domínio individual (keraton tipo família)
    // Encontra produtos em sites menores mesmo sem alias cadastrado
    ...(layered.wide || []).slice(0, 1).flatMap((term) =>
      domains.slice(0, 5).map((domain) => ({
        name: `Google Wide:${domain}`,
        enabled: Boolean(process.env.SERPAPI_KEY) && Boolean(term),
        search: () => searchGoogleWebMedium(term, [domain]),
      }))
    ),
  ].filter((connector) => connector.enabled);

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
