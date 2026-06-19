const { searchByEan } = require('./mercadoLivre');
const { searchGoogleShopping } = require('./serpApi');

function deduplicate(listings) {
  const seen = new Set();
  return listings.filter((item) => {
    const key = item.link || `${item.marketplace}|${item.title}|${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchAllMarketplaces(ean) {
  const connectors = [
    { name: 'Mercado Livre', enabled: true, search: searchByEan },
    { name: 'Google Shopping', enabled: Boolean(process.env.SERPAPI_KEY), search: searchGoogleShopping }
  ].filter((connector) => connector.enabled);

  const settled = await Promise.allSettled(connectors.map((connector) => connector.search(ean)));
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

module.exports = { searchAllMarketplaces };
