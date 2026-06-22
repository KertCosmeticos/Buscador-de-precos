function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ── Dicionários de relevância ─────────────────────────────────────────────────

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

// Domínios que não são lojas reais: redes sociais, catálogos de EAN, comparadores.
const blockedDomains = new Set([
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'pinterest.com', 'youtube.com', 'linkedin.com', 'whatsapp.com',
  'bluesoft.com.br', 'cosmos.com.br', 'cosmosonline.com.br',
  'consultaremedios.com.br', 'bulas.med.br', 'bulasec.com.br',
  'buscape.com.br', 'bondfaro.com.br', 'zoom.com.br', 'jacotei.com.br',
  'melhoresdescontos.com.br', 'melhornegocio.com.br',
  'canaltech.com.br', 'tecmundo.com.br', 'tudocelular.com',
]);

// ── Tokenização ────────────────────────────────────────────────────────────────

function tokenize(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+(?:ml|g|gr|kg|un|l)$/.test(t));
}

function tokens(value) {
  return tokenize(value).filter((t) => !genericWords.has(t));
}

function tokenMatches(a, b) {
  return a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));
}

function extractColorTokens(productName) {
  return tokens(productName).filter((t) => !ownBrands.has(t));
}

// ── Validação de relevância (texto) ───────────────────────────────────────────

function relevant(text, product, link = '') {
  return ProductMatcher.matchesOffer(text, link, product).relevant;
}

// ── Validação de URL de destino ────────────────────────────────────────────────
//
// Valida se o caminho da URL é compatível com o produto buscado.
// Resolve o problema de links errados: um painel de comparação pode ter links para
// "casanorte.com.br/sh-nutriex-500ml-moranguinho" com texto "Canela Keraton" —
// o texto passa no filtro, mas o caminho da URL entrega o produto errado.
//
// URLs com path curto ou opaco (IDs numéricos) são aceitas sem verificação.
// URLs com path descritivo devem conter pelo menos 1 token de cor do produto.
function linkPathMatchesProduct(link, product) {
  return ProductMatcher.linkMatchesProduct(link, product);
}

// ── Extração de preço ─────────────────────────────────────────────────────────

function priceFromText(text) {
  const prices = [];
  for (const match of cleanText(text).matchAll(/R\$\s*([\d.]+),(\d{2})/gi)) {
    const context = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60);
    // "Frete grátis" costuma aparecer ao lado do preço real do produto. Não
    // descarte a oferta inteira só por isso; bloqueie apenas valores claramente
    // identificados como parcela, cupom, desconto ou economia.
    if (/(cupom|parcela|economize|desconto|salve|\boff\b)/i.test(context)) continue;
    const price = Number(`${match[1].replaceAll('.', '')}.${match[2]}`);
    if (Number.isFinite(price) && price > 0.5) prices.push(price);
  }
  return prices.length ? Math.min(...prices) : null;
}

// ── Utilitários de link ───────────────────────────────────────────────────────

function isExternalLink(href) {
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) && !url.hostname.includes('google.');
  } catch { return false; }
}

function isBlockedDomain(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    return blockedDomains.has(host) || [...blockedDomains].some((d) => host.endsWith('.' + d));
  } catch { return false; }
}

function directUrl(anchor) {
  const pcu = anchor.dataset.pcu || anchor.closest('[data-pcu]')?.dataset.pcu;
  if (pcu && isExternalLink(pcu)) return pcu;
  const href = anchor.href;
  if (!href) return '';
  try {
    const url = new URL(href, window.location.href);
    if (url.hostname.includes('google.')) {
      for (const key of ['adurl', 'url', 'q']) {
        const redirected = url.searchParams.get(key);
        if (redirected && /^https?:\/\//i.test(redirected) && isExternalLink(redirected)) return redirected;
      }
      return '';
    }
    if (isExternalLink(url.href)) return url.href;
  } catch { /* ignora */ }
  return '';
}

function sellerFromLink(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    const known = {
      'amazon.com.br': 'Amazon', 'mercadolivre.com.br': 'Mercado Livre',
      'mercadoshops.com.br': 'Mercado Shops', 'shopee.com.br': 'Shopee',
      'magazineluiza.com.br': 'Magazine Luiza', 'americanas.com.br': 'Americanas',
      'submarino.com.br': 'Submarino', 'belezanaweb.com.br': 'Beleza na Web',
      'perfumariasumire.com.br': 'Sumirê', 'epocacosmeticos.com.br': 'Época Cosméticos',
      'drogariasaopaulo.com.br': 'Drogaria SP', 'drogasil.com.br': 'Drogasil',
      'drogaraia.com.br': 'Droga Raia', 'ultrafarma.com.br': 'Ultrafarma',
      'belezasaudavel.com.br': 'Beleza & Saúde', 'natubella.com.br': 'Natubella',
      'livialdistribuidora.com.br': 'Livial', 'riobelcosmeticos.com.br': 'Riobel',
      'keraton.com.br': 'Keraton (oficial)', 'kertcosmeticos.com.br': 'Kert Cosméticos',
      'lojaslivia.com.br': 'Lojas Lívia', 'kibeleza.com.br': 'Ki-Beleza',
      'akaicosmeticos.com.br': 'Akai Cosméticos', 'belezayou.com.br': 'Beleza You',
      'riobelleza.com.br': 'Rio Belleza', 'riobelcosmeticos.com.br': 'Rio Bel',
      'farmais.com.br': 'Farmais',
    };
    return known[host] || host.split('.')[0].replace(/(^|[-_])\w/g, (v) => v.replace(/[-_]/, '').toUpperCase());
  } catch { return 'Loja'; }
}

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag|source|medium|campaign)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return value || ''; }
}

function resultContainer(anchor) {
  let el = anchor;
  for (let i = 0; el && i < 15; i += 1, el = el.parentElement) {
    const text = cleanText(el.innerText || '');
    if (/R\$\s*[\d.]+,\d{2}/i.test(text) && text.length >= 15 && text.length <= 5000) return el;
  }
  return null;
}

// ── Construção de listing ─────────────────────────────────────────────────────

function buildListing(link, text, container, product) {
  if (isBlockedDomain(link)) return null;
  // Valida o caminho da URL: evita links onde o produto na URL é claramente diferente
  // (ex: casanorte.com/nutriex-moranguinho quando buscamos Canela)
  if (!linkPathMatchesProduct(link, product)) return null;
  const price = priceFromText(text);
  if (!Number.isFinite(price)) return null;
  if (!relevant(text, product, link)) return null;
  const heading = container.querySelector('h3, h2, h4, [role="heading"]');
  const title = cleanText(heading?.innerText || product.name || '');
  if (!title) return null;
  const seller = sellerFromLink(link);
  return { title, price, seller, marketplace: seller, link, soldQuantity: null, condition: 'new',
           freeShipping: /frete\s+gr[aá]tis/i.test(text) };
}

// ── Extração principal ────────────────────────────────────────────────────────

function extractListings(product) {
  const listings = new Map();

  // Estratégia 1: link-first
  // Cobre todos os links da página (Shopping widget, cards individuais, anúncios).
  // A validação de URL garante que links para produtos errados são descartados.
  document.querySelectorAll('a[href]').forEach((anchor) => {
    const link = normalizeLink(directUrl(anchor));
    if (!link || listings.has(link)) return;
    const container = resultContainer(anchor);
    if (!container) return;
    const text = cleanText(container.innerText || '');
    const listing = buildListing(link, text, container, product);
    if (listing) listings.set(link, listing);
  });

  // Estratégia 2: card-first
  // Cobre rich snippets onde o preço fica fora do ancestor do link.
  document.querySelectorAll('.g, .MjjYud, .Gx5Zad, #rso > div, [data-hveid]').forEach((card) => {
    const text = cleanText(card.innerText || '');
    if (!text || text.length < 20 || text.length > 6000) return;
    const price = priceFromText(text);
    if (!Number.isFinite(price)) return;
    if (!relevant(text, product)) return;
    let link = '';
    for (const a of card.querySelectorAll('a[href]')) {
      const url = directUrl(a);
      if (url && !isBlockedDomain(url)) { link = normalizeLink(url); break; }
    }
    if (!link || listings.has(link)) return;
    if (!linkPathMatchesProduct(link, product)) return;
    const heading = card.querySelector('h3, h2, h4, [role="heading"]');
    const title = cleanText(heading?.innerText || '');
    if (!title) return;
    const seller = sellerFromLink(link);
    listings.set(link, { title, price, seller, marketplace: seller, link,
                          soldQuantity: null, condition: 'new',
                          freeShipping: /frete\s+gr[aá]tis/i.test(text) });
  });

  return [...listings.values()];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'EXTRACT_GOOGLE_RESULTS') return;
  const pageText = document.body?.innerText || '';
  const captcha = /tráfego incomum|unusual traffic|não sou um robô|not a robot/i.test(pageText);
  sendResponse({ captcha, listings: captcha ? [] : extractListings(message.product || {}) });
});
