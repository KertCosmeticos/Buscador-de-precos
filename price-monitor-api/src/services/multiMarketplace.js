const { searchByEan } = require('./mercadoLivre');
const { searchGoogleShopping } = require('./serpApi');

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

async function searchAllMarketplaces(ean, productName = '') {
  const connectors = [
    { name: 'Mercado Livre', enabled: true, search: () => searchByEan(ean) },
    { name: 'Google Shopping e Web', enabled: Boolean(process.env.SERPAPI_KEY), search: () => searchGoogleShopping(ean, productName) }
  ].filter((connector) => connector.enabled);

  const settled = await Promise.allSettled(connectors.map((connector) => connector.search()));
  const sources = settled.map((result, index) => ({
    name: connectors[index].name,
    status: result.status === 'fulfilled' ? 'ok' : 'error',
    count: result.status === 'fulfilled' ? result.value.length : 0,
    error: result.status === 'rejected' ? result.reason.message : undefined
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

module.exports = { searchAllMarketplaces, deduplicate };
