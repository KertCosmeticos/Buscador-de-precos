// ── ProductMatcher inline (igual ao product-matcher.js dos content scripts) ────
const ProductMatcher = (() => {
  const ownBrands = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);
  const competitorBrands = new Set([
    'acquaflora', 'alfaparf', 'amend', 'anaconda', 'beautycolor', 'biocolor',
    'brae', 'cadiveu', 'casting', 'ckamura', 'clairol', 'colorissimo', 'corton',
    'dove', 'embelleze', 'eudora', 'garnier', 'haskell', 'helpex', 'igora',
    'inoar', 'itallian', 'italianhair', 'kamaleao', 'kamura', 'keune', 'koleston',
    'kostume', 'loreal', 'mairibel', 'maxton', 'natucor', 'natura', 'nature',
    'naturе', 'niely', 'nivea', 'novex', 'nutriex', 'pantene', 'redken', 'revlon',
    'salon', 'salonline', 'schwarzkopf', 'seda', 'skala', 'softcolor', 'truss',
    'tresemme', 'wella', 'yama'
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
    { id: 'muito-liso', detect: /muito\s*(?:\+|mais\s*\+?)?\s*liso/i, anchors: ['muito', 'liso'] },
    { id: 'muito-cachos', detect: /muito\s*(?:\+|mais\s*\+?)?\s*cachos/i, anchors: ['muito', 'cachos'] },
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
    if (line?.id?.startsWith('muito-')) excluded.add('mais');
    const remaining = nameTokens.filter((token) => !excluded.has(token) && !volumePattern.test(token));
    const variants = isColorProduct && !shadeCode ? [...new Set(remaining)] : [];
    const identity = isColorProduct ? [] : [...new Set(remaining.filter((token) => token.length >= 3))];

    return { name, category, family, brands, type, line, shadeCode, volume, isColorProduct, variants, identity };
  }

  const competitorPhrases = [/\bmeu\s+liso\b/i];

  function hasCompetingBrand(received) {
    if (received.some((token) => competitorBrands.has(token))) return true;
    const joined = received.join(' ');
    return competitorPhrases.some((re) => re.test(joined));
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

  function addOwnBrands(brands) {
    brands.forEach((b) => { const n = normalize(b); if (n) ownBrands.add(n); });
  }

  return { buildProfile, buildSemanticQuery, matchesOffer, linkMatchesProduct, normalize, tokenize, addOwnBrands };
})();

// ── Funções auxiliares ─────────────────────────────────────────────────────────

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePost(port, message) {
  try { port.postMessage(message); } catch { /* painel fechado */ }
}

function waitForTab(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('A pagina demorou demais para carregar.'));
    }, timeout);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type, ...payload });
    } catch (error) {
      lastError = error;
      await delay(700);
    }
  }
  throw lastError || new Error('Nao foi possivel ler a pagina de pesquisa.');
}

async function searchGoogle(query, product, mode = 'web', windowId = null) {
  const parameters = new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'br', num: '30' });
  if (mode === 'shopping') parameters.set('tbm', 'shop');
  const tabOptions = { url: 'about:blank', active: false };
  if (windowId) tabOptions.windowId = windowId;
  const tab = await chrome.tabs.create(tabOptions);
  let keepOpen = false;
  try {
    await navigateTab(tab.id, `https://www.google.com/search?${parameters}`);
    await delay(mode === 'shopping' ? 2600 : 1600);
    let result;
    try {
      result = await sendToTab(tab.id, 'EXTRACT_GOOGLE_RESULTS', { product });
    } catch (sendError) {
      const currentTab = await chrome.tabs.get(tab.id).catch(() => null);
      const currentUrl = currentTab?.url || '';
      if (/\/sorry\/|consent\.google|\/recaptcha/i.test(currentUrl)) {
        keepOpen = true;
        await chrome.tabs.update(tab.id, { active: true });
        if (windowId) await chrome.windows.update(windowId, { state: 'normal', focused: true }).catch(() => {});
        throw new Error('O Google solicitou verificacao. Resolva o CAPTCHA na aba aberta e repita a busca.');
      }
      throw sendError;
    }
    if (result?.captcha) {
      keepOpen = true;
      await chrome.tabs.update(tab.id, { active: true });
      if (windowId) await chrome.windows.update(windowId, { state: 'normal', focused: true }).catch(() => {});
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

async function searchMercadoLivre(product, windowId = null) {
  const tabOptions = { url: 'about:blank', active: false };
  if (windowId) tabOptions.windowId = windowId;
  const tab = await chrome.tabs.create(tabOptions);
  try {
    await navigateTab(tab.id, mercadoLivreUrl(product.name || product.ean));
    await delay(2200);
    const result = await sendToTab(tab.id, 'EXTRACT_ML_RESULTS', { product });
    return result?.listings || [];
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
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
    return sites.some((site) => { const domain = siteDomain(site); return domain && (hostname === domain || hostname.endsWith(`.${domain}`)); });
  } catch { return false; }
}

async function runSearch(port, message) {
  const requestId = message.requestId;
  const products = Array.isArray(message.products) ? message.products.slice(0, 5) : [];
  const sites = Array.isArray(message.sites) ? message.sites.slice(0, 20) : [];
  if (!products.length) throw new Error('Nenhum produto valido foi enviado a extensao.');
  const ownBrands = message.config?.ownBrands;
  if (Array.isArray(ownBrands) && ownBrands.length) ProductMatcher.addOwnBrands(ownBrands);

  let incognitoWindowId = null;
  let captchaEncountered = false;
  try {
    const win = await chrome.windows.create({ url: 'about:blank', incognito: true, state: 'minimized', focused: false });
    incognitoWindowId = win.id;
  } catch {
    // Extensao nao habilitada em modo anonimo — usa abas normais
  }

  const totalSteps = products.length * 5;
  let completedSteps = 0;
  const results = [];

  for (const product of products) {
    const listings = [];
    const sources = [];
    const label = product.name || product.ean;
    const semantic = ProductMatcher.buildSemanticQuery(product);
    const domains = [...new Set(sites.map(siteDomain).filter(Boolean))];
    const siteClause = domains.length ? `(${domains.slice(0, 8).map((domain) => `site:${domain}`).join(' OR ')})` : '';
    const steps = sites.length ? [
      { name: 'Sites por EAN', query: `${product.ean} ${siteClause}`, mode: 'web', exactEan: true },
      { name: 'Sites por nome', query: `"${product.name || product.ean}" ${siteClause}`, mode: 'web' },
      { name: 'Sites por semantica', query: `${semantic || product.name || product.ean} ${siteClause}`, mode: 'web' },
      { name: 'Descoberta Google Shopping', query: product.name || product.ean, mode: 'shopping', discovery: true }
    ] : [
      { name: 'Google EAN', query: product.ean, mode: 'web', exactEan: true },
      { name: 'Google Nome', query: product.name || product.ean, mode: 'web' },
      { name: 'Google Semantico', query: semantic || product.name || product.ean, mode: 'web' },
      { name: 'Google Shopping', query: product.name || product.ean, mode: 'shopping' }
    ];

    let googleBlocked = false;
    for (const step of steps) {
      safePost(port, {
        type: 'BROWSER_SEARCH_PROGRESS', requestId,
        completed: completedSteps, total: totalSteps,
        message: `Pesquisando ${label} em ${step.name}...`
      });
      if (googleBlocked) {
        sources.push({ name: step.name, status: 'skipped', count: 0, error: 'Google bloqueado por CAPTCHA' });
        completedSteps += 1;
        continue;
      }
      try {
        const found = step.query
          ? await searchGoogle(step.query, step.exactEan ? { ...product, searchMode: 'ean' } : product, step.mode, incognitoWindowId)
          : [];
        const selected = sites.length
          ? found.filter((listing) => step.discovery || listingMatchesSites(listing, sites))
            .map((listing) => step.discovery && !listingMatchesSites(listing, sites) ? { ...listing, discoveryCandidate: true } : listing)
          : found;
        listings.push(...selected);
        sources.push({ name: step.name, status: 'ok', count: selected.length });
      } catch (error) {
        sources.push({ name: step.name, status: 'error', count: 0, error: error.message });
        if (/CAPTCHA|verificacao/i.test(error.message)) { googleBlocked = true; captchaEncountered = true; }
      }
      completedSteps += 1;
    }

    const mercadoLivreEnabled = !sites.length || sites.some((site) => /mercado\s*livre/i.test(site.name) || /mercadolivre\.com\.br$/.test(siteDomain(site)));
    safePost(port, {
      type: 'BROWSER_SEARCH_PROGRESS', requestId,
      completed: completedSteps, total: totalSteps,
      message: `Pesquisando ${label} no Mercado Livre...`
    });
    if (mercadoLivreEnabled) {
      try {
        const found = await searchMercadoLivre(product, incognitoWindowId);
        listings.push(...found);
        sources.push({ name: 'Mercado Livre', status: 'ok', count: found.length });
      } catch (error) {
        sources.push({ name: 'Mercado Livre', status: 'error', count: 0, error: error.message });
      }
    } else {
      sources.push({ name: 'Mercado Livre', status: 'skipped', count: 0 });
    }
    completedSteps += 1;
    results.push({ ean: product.ean, listings: deduplicate(listings), sources });
  }

  safePost(port, { type: 'BROWSER_SEARCH_RESULT', requestId, results });

  if (incognitoWindowId && !captchaEncountered) {
    await chrome.windows.remove(incognitoWindowId).catch(() => {});
  }
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
