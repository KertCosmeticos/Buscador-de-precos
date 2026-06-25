const axios = require('axios');

const mlApi = axios.create({
  baseURL: 'https://api.mercadolibre.com',
  timeout: 10000,
  headers: { 'User-Agent': 'price-monitor-api/1.0' }
});

function sellerName(item) {
  return (
    item.seller?.nickname ||
    item.seller?.name ||
    item.official_store_name ||
    (item.seller?.id ? `Vendedor ${item.seller.id}` : 'Vendedor não informado')
  );
}

function normalizeItem(item) {
  return {
    title: item.title || 'Anúncio sem nome',
    price: Number(item.price),
    seller: sellerName(item),
    marketplace: 'Mercado Livre',
    link: item.permalink || '',
    soldQuantity: Number(item.sold_quantity || 0),
    condition: item.condition || 'not_specified',
    freeShipping: Boolean(item.shipping?.free_shipping)
  };
}

function deduplicateByLink(items) {
  const results = [];
  const seen = new Set();
  items.forEach((item) => {
    const key = item.link || `${item.title}|${item.price}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  });
  return results;
}

async function searchQuery(query) {
  if (!query) return [];
  const { data } = await mlApi.get('/sites/MLB/search', {
    params: { q: query, limit: 50 }
  });

  return (data.results || [])
    .map(normalizeItem)
    .filter((item) => Number.isFinite(item.price));
}

async function searchByEan(ean, productName = '') {
  try {
    const searches = await Promise.allSettled([
      searchQuery(ean),
      ...(productName ? [searchQuery(productName)] : [])
    ]);
    const successful = searches.filter((result) => result.status === 'fulfilled');
    if (!successful.length && searches[0]?.status === 'rejected') throw searches[0].reason;
    return deduplicateByLink(successful.flatMap((result) => result.value));
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      const timeoutError = new Error('O Mercado Livre demorou demais para responder. Tente novamente.');
      timeoutError.status = 504;
      throw timeoutError;
    }

    const apiError = new Error('Não foi possível consultar o Mercado Livre agora. Tente novamente mais tarde.');
    apiError.status = 502;
    throw apiError;
  }
}

module.exports = { searchByEan };
