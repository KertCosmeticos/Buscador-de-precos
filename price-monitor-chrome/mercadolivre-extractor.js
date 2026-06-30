function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ── Relevância (alinhada com google-extractor) ────────────────────────────────

const ownBrands = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);

const competitorBrands = new Set([
  'loreal', 'wella', 'schwarzkopf', 'redken', 'revlon', 'pantene', 'garnier',
  'tresemme', 'elseve', 'dove', 'nivea', 'clairol', 'kamura', 'ckamura',
  'maxton', 'mairibel', 'colorissimo', 'inoar', 'brae', 'cadiveu', 'blueken',
  'novex', 'eudora', 'truss', 'helpex', 'itallian', 'italianhair',
]);

const genericWords = new Set([
  'a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'o', 'os', 'para', 'sem',
  'ampola', 'banho', 'brilho', 'cabelo', 'cabelos', 'coloracao', 'condicionador',
  'creme', 'descolorante', 'finalizador', 'hidratante', 'mascara', 'matizador',
  'oxidante', 'produto', 'reconstrutor', 'selador', 'shampoo', 'spray',
  'tonalizante', 'tratamento', 'umectante', 'unidade', 'uso', 'vol', 'ml', 'g',
]);

function tokenize(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+(?:ml|g|gr|kg|un|l)$/.test(t));
}

function tokenMatches(a, b) {
  return a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));
}

function relevant(text, product) {
  return ProductMatcher.matchesOffer(text, '', product).relevant;
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag|source|medium|campaign|tracking_id)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return value || ''; }
}

function extractPrice(item) {
  const fraction = item.querySelector('.andes-money-amount__fraction');
  const cents    = item.querySelector('.andes-money-amount__cents');
  if (fraction) {
    const value = parseFloat(
      fraction.textContent.replace(/\./g, '').trim() + '.' + (cents?.textContent.trim() || '00')
    );
    if (Number.isFinite(value) && value > 0) return value;
  }
  const text = cleanText(item.innerText || '');
  for (const match of text.matchAll(/R\$\s*([\d.]+),(\d{2})/gi)) {
    const before = text.slice(Math.max(0, match.index - 45), match.index);
    if (/(frete|entrega|envio|cupom)[^R$]{0,24}$/i.test(before)) continue;
    const price = Number(`${match[1].replaceAll('.', '')}.${match[2]}`);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

function extractSeller(item) {
  const selectors = [
    '.ui-search-official-store-label',
    '.ui-search-item__store-label',
    '[class*="store-label"]',
    '[class*="official-store"]',
  ];
  for (const sel of selectors) {
    const el = item.querySelector(sel);
    if (el) return cleanText(el.textContent);
  }
  return 'Mercado Livre';
}

// ── Extração principal ────────────────────────────────────────────────────────

function extractMLListings(product) {
  const listings = [];
  const seen = new Set();

  document.querySelectorAll(
    '.ui-search-result, .andes-card[class*="search"], li[class*="search-layout__item"]'
  ).forEach((item) => {
    const linkEl = item.querySelector(
      'a.ui-search-link, a[href*="mercadolivre.com.br"], a[href*="mercadoshops.com.br"]'
    );
    if (!linkEl) return;

    const link = normalizeLink(linkEl.href || '');
    if (!link || seen.has(link)) return;

    const price = extractPrice(item);
    if (!Number.isFinite(price) || price <= 0) return;

    const titleEl = item.querySelector(
      '.ui-search-item__title, h2[class*="title"], [class*="item__title"]'
    );
    const title = cleanText(titleEl?.textContent || linkEl.getAttribute('aria-label') || '');
    if (!title) return;

    if (!ProductMatcher.linkMatchesProduct(link, product) || !relevant(`${title} ${link}`, product)) return;

    seen.add(link);

    const freeShipping = !!item.querySelector(
      '.ui-search-item__shipping--free, [class*="shipping-free"], [class*="free-shipping"]'
    );
    const conditionEl = item.querySelector('[class*="item__condition"], [class*="condition"]');
    const condition   = /usado|usad/i.test(conditionEl?.textContent || '') ? 'used' : 'new';
    const soldEl      = item.querySelector('[class*="sold-quantity"], [class*="sales"]');
    const soldMatch   = soldEl?.textContent.match(/(\d[\d.]*)/);
    const soldQuantity = soldMatch ? parseInt(soldMatch[1].replace(/\./g, ''), 10) : null;

    listings.push({ title, price, seller: extractSeller(item), marketplace: 'Mercado Livre',
                    link, soldQuantity, condition, freeShipping });
  });

  return listings;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'EXTRACT_ML_RESULTS') return;
  sendResponse({ listings: extractMLListings(message.product || {}) });
});
