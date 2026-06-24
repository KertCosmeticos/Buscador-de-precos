(function initializeProductMatcher(root, factory) {
  const matcher = factory();
  root.ProductMatcher = matcher;
  if (typeof module === 'object' && module.exports) module.exports = matcher;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const ownBrands = new Set(['kert', 'keraton', 'phytogen', 'keragen', 'reduton']);
  const competitorBrands = new Set([
    'acquaflora', 'alfaparf', 'amend', 'anaconda', 'beautycolor', 'biocolor',
    'brae', 'cadiveu', 'casting', 'ckamura', 'clairol', 'colorissimo', 'corton',
    'dove', 'embelleze', 'eudora', 'garnier', 'haskell', 'helpex', 'igora',
    'inoar', 'itallian', 'italianhair', 'kamaleao', 'kamura', 'keune', 'koleston',
    'kostume', 'loreal', 'mairibel', 'maxton', 'natucor', 'niely', 'nivea',
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
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/([a-z])['\u2019]([a-z])/g, '$1$2')
      .replace(/n[\u00ba\u00b0]\s*/g, '').replace(/[^a-z0-9.]+/g, ' ')
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
    return competitorPhrases.some((re) => re.test(joined));
  }

  function matchesOffer(text, link, product = {}) {
    if (product.searchMode === 'ean') return { relevant: true, confidence: 'ean', reason: 'Pesquisa exata por EAN.' };
    const profile = buildProfile(product);
    const received = tokenize(`${text} ${link || ''}`);
    if (hasCompetingBrand(received)) return { relevant: false, reason: 'Marca concorrente identificada.' };

    const productIsKit = /\b(?:kit|combo|conjunto)\b/.test(profile.name);
    const resultIsKit = received.some((token) => ['kit', 'combo', 'conjunto'].includes(token));
    if (!productIsKit && resultIsKit) return { relevant: false, reason: 'O anúncio é um kit diferente do produto unitário.' };

    if (profile.shadeCode && !received.includes(profile.shadeCode)) {
      return { relevant: false, reason: `Nuance ${profile.shadeCode} ausente.` };
    }
    if (profile.variants.length && !profile.variants.every((variant) => received.some((token) => tokenMatches(variant, token)))) {
      return { relevant: false, reason: `Variante obrigatória ausente: ${profile.variants.join(' ')}.` };
    }

    if (profile.type && !profile.type.alternatives.some((alternative) => containsSequence(received, alternative))) {
      return { relevant: false, reason: `Tipo incompatível com ${profile.type.id}.` };
    }
    if (profile.line && !containsSequence(received, profile.line.anchors)) {
      return { relevant: false, reason: `Linha ${profile.line.id} ausente.` };
    }
    if (profile.brands.length && !received.some((token) => ownBrands.has(token))) {
      return { relevant: false, reason: 'Marca própria ausente no título do anúncio.' };
    }

    if (profile.identity.length) {
      const matched = profile.identity.filter((expected) => received.some((token) => tokenMatches(expected, token)));
      if (matched.length < Math.max(1, Math.ceil(profile.identity.length * 0.6))) {
        return { relevant: false, reason: 'Poucos termos de identidade do produto.' };
      }
    }
    return { relevant: true, confidence: profile.brands.some((brand) => received.includes(brand)) ? 'high' : 'semantic', reason: 'Marca/tipo/linha/variante compatíveis.' };
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

  function addOwnBrands(brands) {
    brands.forEach((b) => { const n = normalize(b); if (n) ownBrands.add(n); });
  }

  return { buildProfile, buildSemanticQuery, buildMarketplaceQuery, matchesOffer, linkMatchesProduct, normalize, tokenize, addOwnBrands };
}));
