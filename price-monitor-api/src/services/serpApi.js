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

const trustedBrands = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);
const genericProductWords = new Set([
  'a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'para', 'sem',
  'banho', 'brilho', 'cabelo', 'cabelos', 'coloracao', 'condicionador', 'creme',
  'descolorante', 'kit', 'mascara', 'oxidante', 'produto', 'shampoo', 'tonalizante',
  'tratamento', 'unidade', 'uso', 'vol'
]);

function searchTokens(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^\d+(?:ml|g|gr|kg)$/.test(token));
}

function tokensMatch(expected, received) {
  return expected === received
    || (expected.length >= 6 && received.length >= 6 && expected.slice(0, 6) === received.slice(0, 6));
}

function isRelevantOffer(title, productName) {
  if (!productName) return true;
  const expected = searchTokens(productName);
  const received = searchTokens(title);
  const expectedBrands = expected.filter((token) => trustedBrands.has(token));
  const receivedHasExpectedBrand = expectedBrands.length
    ? expectedBrands.some((brand) => received.includes(brand) || (brand !== 'kert' && received.includes('kert')))
    : received.some((token) => trustedBrands.has(token));
  if (!receivedHasExpectedBrand) return false;

  const distinctive = expected.filter((token) => !trustedBrands.has(token) && !genericProductWords.has(token));
  if (!distinctive.length) return true;
  const matches = distinctive.filter((token) => received.some((candidate) => tokensMatch(token, candidate)));
  const lastDistinctive = distinctive[distinctive.length - 1];
  return received.some((candidate) => tokensMatch(lastDistinctive, candidate))
    && matches.length >= Math.max(1, Math.ceil(distinctive.length * 0.6));
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

function sellerFromResult(result) {
  if (result.source) return result.source;
  try {
    return new URL(result.link).hostname.replace(/^www\./, '');
  } catch {
    return 'Loja não informada';
  }
}

function priceFromOrganicResult(result) {
  const detected = [
    result.extracted_price,
    result.price,
    result.rich_snippet?.top?.detected_extensions?.price,
    result.rich_snippet?.bottom?.detected_extensions?.price
  ];
  for (const value of detected) {
    const price = numberFromPrice(value);
    if (Number.isFinite(price)) return price;
  }
  const text = [
    result.title,
    result.snippet,
    ...(result.extensions || []),
    ...(result.rich_snippet?.top?.extensions || []),
    ...(result.rich_snippet?.bottom?.extensions || [])
  ].filter(Boolean).join(' ');
  const match = text.match(/R\$\s*([\d.]+,\d{2})/i);
  return match ? numberFromPrice(match[1]) : null;
}

function googleWebOffersFromData(data, productName = '') {
  return (data.organic_results || []).map((result) => {
    const seller = sellerFromResult(result);
    return {
      title: result.title || 'Produto sem nome',
      price: priceFromOrganicResult(result),
      seller,
      marketplace: seller,
      link: result.link || '',
      soldQuantity: null,
      condition: 'new',
      freeShipping: false
    };
  }).filter((item) => Number.isFinite(item.price) && item.link && isRelevantOffer(item.title, productName));
}

async function searchGoogleWeb(ean, productName) {
  const { data } = await serpApi.get('/search.json', {
    params: {
      engine: 'google',
      q: [ean, productName].filter(Boolean).join(' '),
      gl: 'br',
      hl: 'pt-br',
      google_domain: 'google.com.br',
      api_key: process.env.SERPAPI_KEY
    }
  });
  return googleWebOffersFromData(data, productName);
}

async function searchGoogleShopping(ean, productName = '') {
  if (!process.env.SERPAPI_KEY) return [];

  try {
    const shoppingPromise = (async () => {
      let products = await findShoppingProducts(ean);
      if (!products.length && productName) products = await findShoppingProducts(productName);
      if (productName) products = products.filter((product) => isRelevantOffer(product.title, productName));
      products = products.slice(0, 3);
      const offers = await Promise.allSettled(products.map((product) => getDirectSellerOffers(product, ean)));
      return offers.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    })();
    const searches = await Promise.allSettled([shoppingPromise, searchGoogleWeb(ean, productName)]);
    const successful = searches.filter((result) => result.status === 'fulfilled');
    if (!successful.length) throw searches[0].reason;
    return successful.flatMap((result) => result.value);
  } catch (error) {
    const message = error.code === 'ECONNABORTED'
      ? 'O Google Shopping demorou demais para responder.'
      : 'A varredura no Google Shopping falhou.';
    const searchError = new Error(message);
    searchError.source = 'Google Shopping';
    throw searchError;
  }
}

module.exports = { searchGoogleShopping, googleWebOffersFromData, isRelevantOffer };
