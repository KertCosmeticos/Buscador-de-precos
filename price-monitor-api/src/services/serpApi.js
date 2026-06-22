const axios = require('axios');

const serpApi = axios.create({
  baseURL: 'https://serpapi.com',
  timeout: 15000,
  headers: { 'User-Agent': 'price-monitor-api/1.0' }
});

function hasFreeShipping(result) {
  const delivery = String(result.delivery || result.shipping || '').toLowerCase();
  return delivery.includes('grátis') || delivery.includes('free');
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

async function getDirectSellerOffers(product, ean) {
  if (!product.product_id) return [];
  const { data } = await serpApi.get('/search.json', {
    params: {
      engine: 'google_product',
      product_id: product.product_id,
      gl: 'br',
      hl: 'pt-br',
      api_key: process.env.SERPAPI_KEY
    }
  });
  const title = data.product_results?.title || product.title || `Produto ${ean}`;

  return (data.sellers_results?.online_sellers || []).map((seller) => ({
    title,
    price: numberFromPrice(
      seller.extracted_base_price ?? seller.extracted_total_price ?? seller.base_price ?? seller.total_price
    ),
    seller: seller.name || 'Loja não informada',
    marketplace: seller.name || 'Loja não informada',
    // direct_link é a página final da oferta; link pode ser um redirecionamento do Google.
    link: seller.direct_link || '',
    soldQuantity: null,
    condition: 'new',
    freeShipping: hasFreeShipping({
      delivery: (seller.details_and_offers || []).map((detail) => detail.text).join(' ')
    })
  })).filter((item) => Number.isFinite(item.price) && item.link);
}

async function findShoppingProducts(query) {
  const { data } = await serpApi.get('/search.json', {
    params: {
      engine: 'google_shopping',
      q: query,
      gl: 'br',
      hl: 'pt-br',
      api_key: process.env.SERPAPI_KEY
    }
  });
  return (data.shopping_results || []).filter((item) => item.product_id);
}

async function searchGoogleShopping(ean, productName = '') {
  if (!process.env.SERPAPI_KEY) return [];

  try {
    let products = await findShoppingProducts(ean);
    if (!products.length && productName) products = await findShoppingProducts(productName);
    products = products.slice(0, 3);
    const offers = await Promise.allSettled(products.map((product) => getDirectSellerOffers(product, ean)));
    return offers.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  } catch (error) {
    const message = error.code === 'ECONNABORTED'
      ? 'O Google Shopping demorou demais para responder.'
      : 'A varredura no Google Shopping falhou.';
    const searchError = new Error(message);
    searchError.source = 'Google Shopping';
    throw searchError;
  }
}

module.exports = { searchGoogleShopping };
