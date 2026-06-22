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
  return null;
}

function htmlAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes[match[1].toLowerCase()] = match[2].replaceAll('&amp;', '&');
  }
  return attributes;
}

function absoluteUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return '';
  }
}

function isLikelySearchUrl(value) {
  try {
    const url = new URL(value);
    return /\/(busca|buscar|search|pesquisa|catalogsearch)(\/|$)/i.test(url.pathname)
      || ['q', 'query', 'search', 'keyword'].some((key) => url.searchParams.has(key));
  } catch {
    return true;
  }
}

function jsonLdProducts(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => jsonLdProducts(item, found));
  } else if (value && typeof value === 'object') {
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some((type) => String(type).toLowerCase() === 'product')) found.push(value);
    Object.values(value).forEach((item) => jsonLdProducts(item, found));
  }
  return found;
}

function offerDetails(offers, baseUrl) {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const offer of list) {
    if (!offer || typeof offer !== 'object') continue;
    const price = numberFromPrice(offer.price ?? offer.lowPrice ?? offer.highPrice);
    if (Number.isFinite(price)) {
      return { price, directLink: absoluteUrl(offer.url || '', baseUrl) };
    }
  }
  return { price: null, directLink: '' };
}

function productPageDataFromHtml(html, pageUrl) {
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const products = jsonLdProducts(JSON.parse(match[1].trim()));
      for (const product of products) {
        const details = offerDetails(product.offers, pageUrl);
        if (Number.isFinite(details.price)) {
          return {
            price: details.price,
            directLink: details.directLink || absoluteUrl(product.url || '', pageUrl) || pageUrl,
            isProductPage: true
          };
        }
      }
    } catch {
      // Algumas lojas publicam JSON-LD inválido; os metadados abaixo ainda podem funcionar.
    }
  }

  let metaPrice = null;
  let productType = false;
  let canonical = '';
  for (const tag of String(html).match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    const attributes = htmlAttributes(tag);
    const key = String(attributes.property || attributes.name || attributes.itemprop || '').toLowerCase();
    if (key === 'og:type' && String(attributes.content).toLowerCase().includes('product')) productType = true;
    if (['product:price:amount', 'og:price:amount', 'price'].includes(key)) {
      const price = numberFromPrice(attributes.content);
      if (Number.isFinite(price)) metaPrice = price;
    }
    if (tag.toLowerCase().startsWith('<link') && String(attributes.rel).toLowerCase() === 'canonical') {
      canonical = absoluteUrl(attributes.href || '', pageUrl);
    }
  }
  return {
    price: metaPrice,
    directLink: canonical || pageUrl,
    isProductPage: productType || Number.isFinite(metaPrice)
  };
}

async function inspectProductPage(pageUrl) {
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) {
    return null;
  }
  try {
    const { data } = await axios.get(parsed.href, {
      timeout: 7000,
      maxContentLength: 3 * 1024 * 1024,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    return productPageDataFromHtml(data, parsed.href);
  } catch {
    return null;
  }
}

function googleWebOffersFromData(data, productName = '') {
  return (data.organic_results || []).map((result) => {
    const seller = sellerFromResult(result);
    const offer = {
      title: result.title || 'Produto sem nome',
      price: priceFromOrganicResult(result),
      seller,
      marketplace: seller,
      link: result.link || '',
      soldQuantity: null,
      condition: 'new',
      freeShipping: false
    };
    const relevanceText = [result.title, result.snippet, ...(result.extensions || [])].filter(Boolean).join(' ');
    return { offer, relevanceText };
  }).filter(({ offer, relevanceText }) => offer.link && isRelevantOffer(relevanceText, productName))
    .map(({ offer }) => offer);
}

async function resolveGoogleWebOffers(offers) {
  const results = new Array(offers.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < offers.length) {
      const index = nextIndex++;
      const offer = offers[index];
      const needsInspection = !Number.isFinite(offer.price) || isLikelySearchUrl(offer.link);
      const page = needsInspection ? await inspectProductPage(offer.link) : null;
      const price = Number.isFinite(offer.price) ? offer.price : page?.price;
      const directLink = page?.directLink || offer.link;
      const validDirectLink = directLink && !isLikelySearchUrl(directLink);
      results[index] = Number.isFinite(price) && validDirectLink && (!needsInspection || page?.isProductPage)
        ? { ...offer, price, link: directLink }
        : null;
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, offers.length) }, () => worker()));
  return results.filter(Boolean);
}

async function searchGoogleWeb(ean, productName) {
  const { data } = await serpApi.get('/search.json', {
    params: {
      engine: 'google',
      q: productName || ean,
      gl: 'br',
      hl: 'pt-br',
      google_domain: 'google.com.br',
      num: 30,
      api_key: process.env.SERPAPI_KEY
    }
  });
  return resolveGoogleWebOffers(googleWebOffersFromData(data, productName));
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

module.exports = { searchGoogleShopping, googleWebOffersFromData, isRelevantOffer, productPageDataFromHtml };
