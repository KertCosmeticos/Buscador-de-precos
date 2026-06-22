const trustedBrands = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);
const genericWords = new Set([
  'a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'para', 'sem',
  'banho', 'brilho', 'cabelo', 'cabelos', 'coloracao', 'condicionador', 'creme',
  'descolorante', 'kit', 'mascara', 'oxidante', 'produto', 'shampoo', 'tonalizante',
  'tratamento', 'unidade', 'uso', 'vol'
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    .filter((token) => !/^\d+(?:ml|g|gr|kg)$/.test(token));
}

function tokenMatches(expected, received) {
  return expected === received
    || (expected.length >= 6 && received.length >= 6 && expected.slice(0, 6) === received.slice(0, 6));
}

function relevant(text, productName) {
  if (!productName) return true;
  const expected = tokens(productName);
  const received = tokens(text);
  const expectedBrands = expected.filter((token) => trustedBrands.has(token));
  const brandMatches = expectedBrands.length
    ? expectedBrands.some((brand) => received.includes(brand) || (brand !== 'kert' && received.includes('kert')))
    : received.some((token) => trustedBrands.has(token));
  if (!brandMatches) return false;
  const distinctive = expected.filter((token) => !trustedBrands.has(token) && !genericWords.has(token));
  if (!distinctive.length) return true;
  const matched = distinctive.filter((token) => received.some((candidate) => tokenMatches(token, candidate)));
  return matched.length >= Math.max(1, Math.ceil(distinctive.length * 0.6))
    && received.some((candidate) => tokenMatches(distinctive[distinctive.length - 1], candidate));
}

function directUrl(anchor) {
  const candidates = [
    anchor.href,
    anchor.dataset.pcu,
    anchor.closest('[data-pcu]')?.dataset.pcu
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, window.location.href);
      if (/google\./i.test(url.hostname)) {
        for (const key of ['adurl', 'url', 'q']) {
          const redirected = url.searchParams.get(key);
          if (redirected && /^https?:\/\//i.test(redirected) && !/google\./i.test(new URL(redirected).hostname)) return redirected;
        }
        continue;
      }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      return url.href;
    } catch { /* Tenta o próximo candidato. */ }
  }
  return '';
}

function priceFromText(text) {
  const prices = [];
  for (const match of cleanText(text).matchAll(/R\$\s*([\d.]+),(\d{2})/gi)) {
    const context = text.slice(Math.max(0, match.index - 24), match.index + match[0].length + 24);
    if (/(frete|cupom|parcela|economize)/i.test(context)) continue;
    const price = Number(`${match[1].replaceAll('.', '')}.${match[2]}`);
    if (Number.isFinite(price) && price > 0) prices.push(price);
  }
  return prices.length ? Math.min(...prices) : null;
}

function sellerFromLink(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    const known = {
      'amazon.com.br': 'Amazon', 'mercadolivre.com.br': 'Mercado Livre',
      'shopee.com.br': 'Shopee', 'magazineluiza.com.br': 'Magazine Luiza',
      'belezanaweb.com.br': 'Beleza na Web', 'perfumariasumire.com.br': 'Sumirê'
    };
    return known[host] || host.split('.')[0].replace(/(^|[-_])\w/g, (value) => value.replace(/[-_]/, '').toUpperCase());
  } catch {
    return 'Loja não informada';
  }
}

function resultContainer(anchor) {
  let element = anchor;
  for (let level = 0; element && level < 8; level += 1, element = element.parentElement) {
    const text = cleanText(element.innerText);
    if (/R\$\s*[\d.]+,\d{2}/i.test(text) && text.length >= 25 && text.length <= 2200) return element;
  }
  return null;
}

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return value;
  }
}

function extractListings(product) {
  const listings = new Map();
  document.querySelectorAll('#search a[href], #rso a[href]').forEach((anchor) => {
    const link = normalizeLink(directUrl(anchor));
    if (!link || listings.has(link)) return;
    const container = resultContainer(anchor);
    if (!container) return;
    const text = cleanText(container.innerText);
    const price = priceFromText(text);
    if (!Number.isFinite(price) || !relevant(text, product.name)) return;
    const heading = container.querySelector('h3, h2, h4, [role="heading"]');
    const title = cleanText(heading?.innerText || anchor.getAttribute('aria-label') || anchor.innerText || product.name);
    const seller = sellerFromLink(link);
    listings.set(link, {
      title: title || product.name || `Produto ${product.ean}`,
      price,
      seller,
      marketplace: seller,
      link,
      soldQuantity: null,
      condition: 'new',
      freeShipping: /frete\s+gr[aá]tis/i.test(text)
    });
  });
  return [...listings.values()];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'EXTRACT_GOOGLE_RESULTS') return;
  const pageText = document.body?.innerText || '';
  const captcha = /tráfego incomum|unusual traffic|não sou um robô|not a robot/i.test(pageText);
  sendResponse({ captcha, listings: captcha ? [] : extractListings(message.product || {}) });
});
