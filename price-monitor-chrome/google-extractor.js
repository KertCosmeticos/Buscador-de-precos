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
  // Atacadistas/distribuidores sem venda destinada ao consumidor final.
  'liviadistribuidora.com.br', 'dcadistribuidor.com.br', 'ebccosmeticos.com.br',
]);

const nonRetailPattern = /(?:^|[.\/_-])(atacado|atacadista|distribuidor|distribuidora|b2b)(?:[.\/_-]|$)/i;
const nonRetailHostPattern = /atacad|distribuidor|distribuidora|(?:^|[.-])b2b(?:[.-]|$)/i;
const genericResultTitle = /^(?:resultados? da web|videos?|imagens?|shopping|produtos?|mais resultados?|ver tudo)$/i;

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
  for (const match of cleanText(text).matchAll(/R\$\s*([\d.]+),(\d{2})/gi)) {
    const before = text.slice(Math.max(0, match.index - 45), match.index);
    // Desconsidera apenas quando o próprio valor está rotulado como parcela,
    // cupom, frete ou economia. Palavras posteriores não invalidam o preço.
    if (/(?:parcela|cupom|frete|entrega|economize|desconto|salve|\boff\b)[^R$]{0,24}$/i.test(before)) continue;
    const price = Number(`${match[1].replaceAll('.', '')}.${match[2]}`);
    if (Number.isFinite(price) && price > 0.5) return price;
  }
  return null;
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
    return blockedDomains.has(host) || [...blockedDomains].some((d) => host.endsWith('.' + d))
      || nonRetailHostPattern.test(host);
  } catch { return false; }
}

function isConsumerRetailOffer(link, title, text) {
  const normalizedTitle = cleanText(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (isBlockedDomain(link) || genericResultTitle.test(normalizedTitle)) return false;
  try {
    const url = new URL(link);
    const evidence = `${url.hostname} ${url.pathname} ${title}`;
    if (nonRetailPattern.test(evidence.replace(/\s+/g, '-'))) return false;
  } catch { return false; }
  // Sinais inequívocos de portal exclusivamente comercial/B2B.
  return !/(?:venda exclusiva|somente|exclusivo).{0,30}(?:lojistas|revendedores|profissionais)|pedido m[ií]nimo.{0,15}R\$/i.test(text);
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

const cardSelector = [
  '.sh-dgr__grid-result', '.sh-dlr__list-result', '[data-docid]', '.pla-unit',
  '.uEierd', '[data-text-ad]', '.g', '.Gx5Zad'
].join(', ');

function primaryOfferLink(card, heading) {
  let current = heading;
  while (current && current !== card) {
    if (current.matches?.('a[href]')) {
      const link = directUrl(current);
      if (link) return normalizeLink(link);
    }
    current = current.parentElement;
  }
  for (const anchor of card.querySelectorAll('a[href]')) {
    const link = directUrl(anchor);
    if (link) return normalizeLink(link);
  }
  return '';
}

// ── Construção de listing ─────────────────────────────────────────────────────

function buildListing(link, text, container, product) {
  const heading = container.querySelector('h3, h2, h4, [role="heading"]');
  const title = cleanText(heading?.innerText || heading?.textContent || '');
  if (!title || !isConsumerRetailOffer(link, title, text)) return null;
  if (!linkPathMatchesProduct(link, product)) return null;
  const price = priceFromText(text);
  if (!relevant(`${title} ${text}`, product, link)) return null;
  const seller = sellerFromLink(link);
  return { title, price: Number.isFinite(price) ? price : null, seller, marketplace: seller, link,
           needsPriceInspection: !Number.isFinite(price), soldQuantity: null, condition: 'new',
           freeShipping: /frete\s+gr[aá]tis/i.test(text) };
}

// ── Extração principal ────────────────────────────────────────────────────────

function extractListings(product) {
  const listings = new Map();
  // Somente cartões individuais. Não percorremos todos os links da página:
  // menus como "Vídeos" e "Resultados da Web" não podem herdar o preço de
  // outro anúncio que esteja no mesmo agrupador do Google.
  document.querySelectorAll(cardSelector).forEach((card) => {
    const text = cleanText(card.innerText || '');
    if (!text || text.length < 20 || text.length > 1800) return;
    const heading = card.querySelector('h3, h2, h4, [role="heading"]');
    const link = primaryOfferLink(card, heading);
    if (!link || listings.has(link)) return;
    const listing = buildListing(link, text, card, product);
    if (listing) listings.set(link, listing);
  });

  return [...listings.values()];
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'EXTRACT_GOOGLE_RESULTS') return;
    const pageText = document.body?.innerText || '';
    const captcha = /tráfego incomum|unusual traffic|não sou um robô|not a robot/i.test(pageText);
    sendResponse({ captcha, listings: captcha ? [] : extractListings(message.product || {}) });
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = { genericResultTitle, isBlockedDomain, isConsumerRetailOffer, priceFromText };
}
