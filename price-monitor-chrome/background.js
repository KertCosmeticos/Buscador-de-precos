const ProductMatcher = (() => {
  const ownBrands = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);
  const competitorBrands = new Set([
    'acquaflora', 'alfaparf', 'amend', 'anaconda', 'beautycolor', 'biocolor',
    'brae', 'cadiveu', 'casting', 'ckamura', 'clairol', 'colorissimo', 'corton',
    'dove', 'embelleze', 'eudora', 'garnier', 'haskell', 'helpex', 'igora',
    'inoar', 'itallian', 'italianhair', 'kamaleao', 'kamura', 'keune', 'koleston',
    'kostume', 'loreal', 'mairibel', 'maxton', 'myphios', 'natucor', 'niely', 'nivea',
    'novex', 'nutriex', 'pantene', 'redken', 'revlon', 'salon', 'salonline',
    'schwarzkopf', 'skala', 'softcolor', 'truss', 'tresemme', 'wella', 'yama'
  ]);
  const fillerWords = new Set([
    'a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'o', 'os',
    'para', 'por', 'sem', 'produto', 'unidade', 'uso'
  ]);
  const volumePattern = /^\d+(?:[.,]\d+)?(?:ml|g|gr|kg|l)$/;
  const colorCategories = /coloracao|tonalizante|matizador|oxidante|descolorante/i;

  const typeRules = [
    { id: 'banho-brilho', detect: /banho\s+de\s+brilho/i, alternatives: [['banho'], ['brilho'], ['tonalizante'], ['coloracao'], ['tintura'], ['mascara', 'tonalizante']] },
    { id: 'shampoo', detect: /\b(?:shampoo|sh)\b/i, alternatives: [['shampoo'], ['sh']] },
    { id: 'condicionador', detect: /\b(?:condicionador|cond|conditioner)\b/i, alternatives: [['condicionador'], ['cond'], ['conditioner']] },
    { id: 'mascara', detect: /\b(?:mascara|mask|masc)\b/i, alternatives: [['mascara'], ['mask'], ['masc']] },
    { id: 'leave-in', detect: /\b(?:leave[ -]?in|creme\s+de\s+pentear)\b/i, alternatives: [['leave', 'in'], ['creme', 'pentear']] },
    { id: 'oxidante', detect: /\boxidante\b/i, alternatives: [['oxidante'], ['revelador'], ['oxigenada']] },
    { id: 'descolorante', detect: /\b(?:descolorante|dust\s+free|blond)\b/i, alternatives: [['descolorante'], ['dust', 'free'], ['blond']] },
    { id: 'serum', detect: /\bserum\b/i, alternatives: [['serum']] },
    { id: 'oleo', detect: /\boleo\b/i, alternatives: [['oleo'], ['oil']] },
    { id: 'gelatina', detect: /\bgelatina\b/i, alternatives: [['gelatina'], ['jelly']] },
    { id: 'spray', detect: /\bspray\b/i, alternatives: [['spray']] },
    { id: 'relaxamento', detect: /\brelaxamento\b/i, alternatives: [['relaxamento'], ['alisamento']] },
    { id: 'redutor-cor', detect: /\b(?:redutor\s+de\s+cor|reduton|dye\s+remover)\b/i, alternatives: [['redutor', 'cor'], ['reduton'], ['dye', 'remover']] }
  ];

  const lineRules = [
    { id: 'dual-block', detect: /color\s+dual\s+block/i, anchors: ['dual', 'block'] },
    { id: 'selfie-my-crush', detect: /selfie\s+my\s+crush/i, anchors: ['selfie', 'crush'] },
    { id: 'selfie', detect: /\bselfie\b/i, anchors: ['selfie'] },
    { id: 'demi-color', detect: /demi\s+color/i, anchors: ['demi'] },
    { id: 'color-cachos', detect: /color\s+cachos/i, anchors: ['cachos'] },
    { id: 'neon-colors', detect: /neon\s+colors/i, anchors: ['neon'] },
    { id: 'hard-color', detect: /hard\s+colors?/i, anchors: ['hard'] },
    { id: 'shine-mask', detect: /shine\s+mask/i, anchors: ['shine'] },
    { id: 'men', detect: /\bkeraton\s+men\b/i, anchors: ['men'] },
    { id: 'muito-liso', detect: /muito\s*\+?\s*liso/i, anchors: ['muito', 'liso'] },
    { id: 'muito-cachos', detect: /muito\s*\+?\s*cachos/i, anchors: ['muito', 'cachos'] },
    { id: 'uso-essencial', detect: /uso\s+essencial/i, anchors: ['essencial'] },
    { id: 'desmaia-fio', detect: /desmaia\s+fio/i, anchors: ['desmaia', 'fio'] },
    { id: 'keragen-evolution', detect: /keragen\s+evolution/i, anchors: ['keragen', 'evolution'] },
    { id: 'mais-cor', detect: /mais\s+cor/i, anchors: ['mais', 'cor'] },
    { id: 'mais-forca', detect: /mais\s+forca/i, anchors: ['mais', 'forca'] },
    { id: 'mais-hidratacao', detect: /mais\s+hidratacao/i, anchors: ['mais', 'hidratacao'] }
  ];

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/([a-z])['’]([a-z])/g, '$1$2')
      .replace(/n[º°]\s*/g, '').replace(/[^a-z0-9.]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function tokenize(value) {
    return normalize(value).split(/\s+/).filter(Boolean).filter((token) => !fillerWords.has(token));
  }

  function tokenMatches(expected, received) {
    return expected === received
      || (expected.length >= 6 && received.length >= 6 && expected.slice(0, 6) === received.slice(0, 6));
  }

  function containsSequence(received, expected) {
    return expected.every((token) => received.some((candidate) => tokenMatches(token, candidate)));
  }

  function findRule(value, rules) {
    const normalized = normalize(value);
    return rules.find((rule) => rule.detect.test(normalized)) || null;
  }

  function extractShadeCode(name) {
    return normalize(name).match(/(?:^|\s)(\d{1,2}\.\d{1,3})(?:\s|$)/)?.[1] || '';
  }

  function buildProfile(product = {}) {
    const name = normalize(product.name);
    const category = normalize(product.category);
    const family = normalize(product.family);
    const nameTokens = tokenize(name);
    const brands = nameTokens.filter((token) => ownBrands.has(token));
    const type = findRule(name, typeRules);
    const line = findRule(name, lineRules);
    const shadeCode = extractShadeCode(name);
    const volume = nameTokens.find((token) => volumePattern.test(token)) || '';
    const isColorProduct = colorCategories.test(category) || colorCategories.test(family)
      || Boolean(shadeCode) || ['banho-brilho', 'demi-color', 'dual-block', 'selfie', 'selfie-my-crush', 'color-cachos', 'neon-colors', 'hard-color', 'shine-mask', 'men'].includes(line?.id || type?.id);

    const excluded = new Set([
      ...brands,
      ...(type?.alternatives.flat() || []),
      ...(line?.anchors || []),
      'color', 'colors', 'keraton', 'kert', 'phytogen', 'keragen', 'n',
      volume, shadeCode
    ]);
    const remaining = nameTokens.filter((token) => !excluded.has(token) && !volumePattern.test(token));
    const variants = isColorProduct && !shadeCode ? [...new Set(remaining)] : [];
    const identity = isColorProduct ? [] : [...new Set(remaining.filter((token) => token.length >= 3))];

    return { name, category, family, brands, type, line, shadeCode, volume, isColorProduct, variants, identity };
  }

  const competitorPhrases = [/\bmeu\s+liso\b/i];

  function hasCompetingBrand(received) {
    if (received.some((token) => competitorBrands.has(token))) return true;
    const joined = received.join(' ');
    return competitorPhrases.some((pattern) => pattern.test(joined));
  }

  function matchesOffer(text, link, product = {}) {
    if (product.searchMode === 'ean') return { relevant: true, confidence: 'ean', reason: 'Pesquisa exata por EAN.' };
    const profile = buildProfile(product);
    const received = tokenize(`${text} ${link || ''}`);
    if (hasCompetingBrand(received)) return { relevant: false, reason: 'Marca concorrente identificada.' };

    const productIsKit = /\b(?:kit|combo|conjunto)\b/.test(profile.name);
    const resultIsKit = received.some((token) => ['kit', 'combo', 'conjunto'].includes(token));
    if (!productIsKit && resultIsKit) return { relevant: false, reason: 'O anuncio e um kit diferente do produto unitario.' };

    if (profile.shadeCode && !received.includes(profile.shadeCode)) {
      return { relevant: false, reason: `Nuance ${profile.shadeCode} ausente.` };
    }
    if (profile.variants.length && !profile.variants.every((variant) => received.some((token) => tokenMatches(variant, token)))) {
      return { relevant: false, reason: `Variante obrigatoria ausente: ${profile.variants.join(' ')}.` };
    }

    if (profile.type && !profile.type.alternatives.some((alternative) => containsSequence(received, alternative))) {
      return { relevant: false, reason: `Tipo incompativel com ${profile.type.id}.` };
    }
    if (profile.line && !profile.line.anchors.some((anchor) => received.some((token) => tokenMatches(anchor, token)))) {
      return { relevant: false, reason: `Linha ${profile.line.id} ausente.` };
    }

    if (profile.identity.length) {
      const matched = profile.identity.filter((expected) => received.some((token) => tokenMatches(expected, token)));
      if (matched.length < Math.max(1, Math.ceil(profile.identity.length * 0.6))) {
        return { relevant: false, reason: 'Poucos termos de identidade do produto.' };
      }
    }
    return { relevant: true, confidence: profile.brands.some((brand) => received.includes(brand)) ? 'high' : 'semantic', reason: 'Marca/tipo/linha/variante compativeis.' };
  }

  function linkMatchesProduct(link, product) {
    if (product?.searchMode === 'ean') return true;
    try {
      const path = decodeURIComponent(new URL(link).pathname);
      const profile = buildProfile(product);
      const pathTokens = tokenize(path);
      if (hasCompetingBrand(pathTokens)) return false;
      if (profile.shadeCode && /\d+\.\d+/.test(path) && !pathTokens.includes(profile.shadeCode)) return false;
      if (profile.variants.length) {
        const variantsInPath = profile.variants.filter((variant) => pathTokens.some((token) => tokenMatches(variant, token)));
        const descriptivePath = pathTokens.filter((token) => /[a-z]/.test(token)).length >= 3;
        if (descriptivePath && variantsInPath.length < profile.variants.length) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  function buildSemanticQuery(product) {
    const profile = buildProfile(product);
    const keys = [profile.shadeCode, ...profile.variants].filter(Boolean);
    const typeTerms = profile.type?.alternatives.map((alternative) => alternative.join(' ')) || [];
    const lineTerms = profile.line?.anchors || [];
    const decisive = [...new Set([...keys, ...lineTerms])];
    if (!decisive.length) decisive.push(...profile.identity.slice(0, 3));
    const typeQuery = typeTerms.length > 1 ? `(${typeTerms.map((term) => `"${term}"`).join(' OR ')})` : typeTerms[0] || '';
    return [...decisive.map((term) => `"${term}"`), typeQuery].filter(Boolean).join(' ');
  }

  function buildMarketplaceQuery(product) {
    const profile = buildProfile(product);
    const canonicalType = profile.type?.alternatives?.[0]?.join(' ') || '';
    const volume = profile.volume || normalize(product.volume || product.grammage || '');
    const identity = profile.isColorProduct ? profile.variants : profile.identity.slice(0, 4);
    return [...new Set([
      ...profile.brands,
      canonicalType,
      ...(profile.line?.anchors || []),
      profile.shadeCode,
      ...identity,
      volume
    ].filter(Boolean))].join(' ');
  }

  return { buildProfile, buildSemanticQuery, buildMarketplaceQuery, matchesOffer, linkMatchesProduct, normalize, tokenize };
})();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePost(port, message) {
  try { port.postMessage(message); } catch { /* painel fechado */ }
}

function waitForTab(tabId, timeout = 45000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeout);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigateTab(tabId, url) {
  const loaded = waitForTab(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
}

async function sendToTab(tabId, type, payload = {}) {
  let lastError;
  let injected = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type, ...payload });
    } catch (error) {
      lastError = error;
      if (!injected && /Receiving end does not exist|Could not establish connection/i.test(error.message || '')) {
        injected = await injectExtractor(tabId);
      }
      await delay(700);
    }
  }
  throw lastError || new Error('Nao foi possivel ler a pagina de pesquisa.');
}

async function injectExtractor(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url || '');
    let files = [];
    if (/(^|\.)google\.com(?:\.br)?$/.test(url.hostname) && url.pathname.startsWith('/search')) {
      files = ['product-matcher.js', 'google-extractor.js'];
    } else if (/(^|\.)mercadolivre\.com\.br$/.test(url.hostname)) {
      files = ['product-matcher.js', 'mercadolivre-extractor.js'];
    }
    if (!files.length) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files });
    await delay(300);
    return true;
  } catch {
    return false;
  }
}

async function searchGoogle(query, product, mode = 'web') {
  const parameters = new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'br', num: '30' });
  if (mode === 'shopping') parameters.set('tbm', 'shop');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  let keepOpen = false;
  try {
    await navigateTab(tab.id, `https://www.google.com/search?${parameters}`);
    await delay(mode === 'shopping' ? 2600 : 1600);
    const result = await sendToTab(tab.id, 'EXTRACT_GOOGLE_RESULTS', { product });
    if (result?.captcha) {
      keepOpen = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('O Google solicitou verificacao. Resolva o CAPTCHA na aba aberta e repita a busca.');
    }
    return result?.listings || [];
  } finally {
    if (!keepOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function mercadoLivreUrl(query) {
  const slug = String(query || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://lista.mercadolivre.com.br/${slug}`;
}

async function searchMercadoLivre(product, query) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  try {
    await navigateTab(tab.id, mercadoLivreUrl(query || product.name || product.ean));
    await delay(2200);
    const result = await sendToTab(tab.id, 'EXTRACT_ML_RESULTS', { product });
    return result?.listings || [];
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function nameWithoutBrand(product) {
  const brand = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);
  return (product.name || '')
    .split(/\s+/)
    .filter((t) => !brand.has(t.toLowerCase()))
    .join(' ')
    .trim();
}

function normalizeLink(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|srsltid|gclid|fbclid|ref|tag|source|campaign)$/i.test(key)) url.searchParams.delete(key);
    });
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return value || ''; }
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

function htmlAttributes(tag) {
  const attributes = {};
  for (const match of String(tag).matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes[match[1].toLowerCase()] = match[2].replaceAll('&amp;', '&');
  }
  return attributes;
}

function absoluteUrl(value, baseUrl) {
  if (!value) return '';
  try { return new URL(value, baseUrl).href; } catch { return ''; }
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
    if (Number.isFinite(price)) return { price, directLink: absoluteUrl(offer.url || '', baseUrl) };
  }
  return { price: null, directLink: '' };
}

function productPageDataFromHtml(html, pageUrl) {
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const product of jsonLdProducts(JSON.parse(match[1].trim()))) {
        const details = offerDetails(product.offers, pageUrl);
        if (Number.isFinite(details.price)) {
          return { price: details.price, directLink: details.directLink || absoluteUrl(product.url || '', pageUrl) || pageUrl, isProductPage: true };
        }
      }
    } catch {
      // Continua para metadados quando o JSON-LD da loja vier invalido.
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
  return { price: metaPrice, directLink: canonical || pageUrl, isProductPage: productType || Number.isFinite(metaPrice) };
}

async function inspectProductPage(pageUrl) {
  let parsed;
  try { parsed = new URL(pageUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  try {
    const response = await fetch(parsed.href, {
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });
    if (!response.ok) return null;
    return productPageDataFromHtml(await response.text(), response.url || parsed.href);
  } catch {
    return null;
  }
}

async function resolveInspectedListings(listings, product) {
  const results = [];
  for (const listing of listings) {
    if (Number.isFinite(listing.price) && !listing.needsInspection) {
      results.push(listing);
      continue;
    }
    const page = await inspectProductPage(listing.link);
    const price = Number.isFinite(listing.price) ? listing.price : page?.price;
    const link = normalizeLink(page?.directLink || listing.link);
    if (!Number.isFinite(price) || !page?.isProductPage) continue;
    if (!ProductMatcher.linkMatchesProduct(link, product) || !ProductMatcher.matchesOffer(`${listing.title} ${link}`, link, product).relevant) continue;
    results.push({ ...listing, price, link, needsInspection: false });
  }
  return results;
}

function deduplicate(listings) {
  const byLink = new Map();
  listings.forEach((listing) => {
    const link = normalizeLink(listing.link);
    if (!link || !Number.isFinite(listing.price)) return;
    const current = byLink.get(link);
    if (!current || listing.price < current.price) byLink.set(link, { ...listing, link });
  });
  return [...byLink.values()];
}

function siteDomain(site) {
  try {
    const domain = new URL(site.searchUrl || site.baseUrl).hostname.replace(/^www\./, '').toLowerCase();
    const expected = [
      { name: /mercado\s*livre/i, domain: 'mercadolivre.com.br' },
      { name: /amazon/i, domain: 'amazon.com.br' },
      { name: /shopee/i, domain: 'shopee.com.br' }
    ].find((rule) => rule.name.test(site.name || ''));
    return expected && !domain.endsWith(expected.domain) ? '' : domain;
  } catch { return ''; }
}

function listingMatchesSites(listing, sites) {
  if (!sites.length) return true;
  try {
    const hostname = new URL(listing.link).hostname.replace(/^www\./, '').toLowerCase();
    return sites.some((site) => {
      const domain = siteDomain(site);
      return domain && (hostname === domain || hostname.endsWith(`.${domain}`));
    });
  } catch { return false; }
}

const priorityDomainGroups = [
  ['amazon.com.br', 'mercadolivre.com.br', 'shopee.com.br', 'magazineluiza.com.br'],
  ['belezanaweb.com.br', 'perfumariasumire.com.br', 'perfumariaseiki.com.br', 'riobelcosmeticos.com.br'],
  ['epocacosmeticos.com.br', 'drogariasaopaulo.com.br', 'drogasil.com.br', 'drogaraia.com.br']
];

function domainGroups(domains, size = 4) {
  const groups = [];
  for (let index = 0; index < domains.length; index += size) groups.push(domains.slice(index, index + size));
  return groups;
}

function siteSearchSteps(product, sites = []) {
  const domains = [...new Set([...sites.map(siteDomain).filter(Boolean), ...priorityDomainGroups.flat()])];
  const baseQuery = ProductMatcher.buildMarketplaceQuery(product) || product.name || product.ean;
  if (!baseQuery || !domains.length) return [];
  const expandedQuery = baseQuery.replace(/\bmuito\s+liso\b/i, 'muito mais liso');
  const queries = [...new Set([baseQuery, expandedQuery])];
  return queries.flatMap((query, queryIndex) => domainGroups(domains, 4).slice(0, 4).map((group, index) => ({
    name: `Google Sites ${queryIndex + 1}.${index + 1}`,
    query: `${query} (${group.map((domain) => `site:${domain}`).join(' OR ')})`,
    mode: 'web'
  })));
}

async function runSearch(port, message) {
  const requestId = message.requestId;
  const products = Array.isArray(message.products) ? message.products.slice(0, 5) : [];
  if (!products.length) throw new Error('Nenhum produto valido foi enviado a extensao.');

  const siteStepsByEan = new Map(products.map((product) => [product.ean, siteSearchSteps(product, message.sites || [])]));
  const totalSteps = products.reduce((total, product) => total + 6 + (siteStepsByEan.get(product.ean)?.length || 0), 0);
  let completedSteps = 0;
  const results = [];

  for (const product of products) {
    const listings = [];
    const sources = [];
    const label = product.name || product.ean;
    const semantic = ProductMatcher.buildSemanticQuery(product);
    const semMarca = nameWithoutBrand(product);
    const steps = [
      { name: 'Google EAN', query: product.ean, mode: 'web', exactEan: true },
      { name: 'Google Nome', query: product.name || product.ean, mode: 'web' },
      { name: 'Google Semantico', query: semantic || product.name || product.ean, mode: 'web' },
      { name: 'Google Sem Marca', query: semMarca || product.name || product.ean, mode: 'web' },
      { name: 'Google Shopping', query: product.name || product.ean, mode: 'shopping' },
      ...(siteStepsByEan.get(product.ean) || [])
    ];

    for (const step of steps) {
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `Pesquisando ${label} em ${step.name}...`
      });
      try {
        const found = step.query
          ? await searchGoogle(step.query, step.exactEan ? { ...product, searchMode: 'ean' } : product, step.mode)
          : [];
        const resolved = await resolveInspectedListings(found, step.exactEan ? { ...product, searchMode: 'ean' } : product);
        listings.push(...resolved);
        sources.push({ name: step.name, status: 'ok', count: resolved.length });
      } catch (error) {
        sources.push({ name: step.name, status: 'error', count: 0, error: error.message });
        if (/CAPTCHA|verificacao/i.test(error.message)) throw error;
      }
      completedSteps += 1;
    }

    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Pesquisando ${label} no Mercado Livre...`
    });
    try {
      const found = await searchMercadoLivre(product, ProductMatcher.buildMarketplaceQuery(product) || product.name || product.ean);
      listings.push(...found);
      sources.push({ name: 'Mercado Livre', status: 'ok', count: found.length });
    } catch (error) {
      sources.push({ name: 'Mercado Livre', status: 'error', count: 0, error: error.message });
    }
    completedSteps += 1;
    results.push({ ean: product.ean, listings: deduplicate(listings), sources });
  }

  safePost(port, { type: 'BROWSER_SEARCH_RESULT', requestId, results });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'price-monitor-bridge') return;
  port.onMessage.addListener((message) => {
    if (message.type === 'BROWSER_EXTENSION_PING') {
      safePost(port, { type: 'BROWSER_EXTENSION_STATUS', available: true });
      return;
    }
    if (message.type !== 'BROWSER_SEARCH_REQUEST') return;
    runSearch(port, message).catch((error) => {
      safePost(port, { type: 'BROWSER_SEARCH_ERROR', requestId: message.requestId, error: error.message });
    });
  });
});
