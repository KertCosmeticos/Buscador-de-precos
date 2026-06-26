const { normalizeText, tokenize } = require('../utils/text');
const { parseListingTitle, normalizeVolume, normalizeNuance } = require('./listingParser');

const COMPETITOR_PATTERN = new RegExp(
  '\\b(?:' + [
    'acquaflora', 'alfaparf', 'amend', 'anaconda', 'beautycolor', 'biocolor',
    'brae', 'cadiveu', 'casting', 'ckamura', 'clairol', 'colorissimo', 'corton',
    'dove', 'embelleze', 'eudora', 'garnier', 'haskell', 'helpex', 'igora',
    'inoar', 'itallian', 'italianhair', 'kamaleao', 'kamura', 'keune', 'koleston',
    'kostume', 'loreal', 'mairibel', 'maxton', 'myphios', 'natucor', 'niely', 'nivea',
    'novex', 'nutriex', 'pantene', 'redken', 'revlon', 'salon', 'salonline',
    'schwarzkopf', 'skala', 'softcolor', 'truss', 'tresemme', 'wella', 'yama',
    'meu\\s+liso'
  ].join('|') + ')\\b', 'i'
);

const TYPE_PATTERNS = [
  { id: 'banho-brilho', pattern: /banho\s+de\s+brilho/i },
  { id: 'shampoo', pattern: /\b(?:shampoo|sh)\b/i },
  { id: 'condicionador', pattern: /\b(?:condicionador|cond|conditioner)\b/i },
  { id: 'mascara', pattern: /\b(?:mascara|mask|masc)\b/i },
  { id: 'leave-in', pattern: /\b(?:leave[ -]?in|creme\s+de\s+pentear)\b/i },
  { id: 'oxidante', pattern: /\boxidante\b/i },
  { id: 'descolorante', pattern: /\b(?:descolorante|dust\s+free|blond)\b/i },
  { id: 'serum', pattern: /\bserum\b/i },
  { id: 'oleo', pattern: /\boleo\b/i },
  { id: 'gelatina', pattern: /\bgelatina\b/i },
  { id: 'spray', pattern: /\bspray\b/i },
  { id: 'relaxamento', pattern: /\brelaxamento\b/i },
  { id: 'redutor-cor', pattern: /\b(?:redutor\s+de\s+cor|reduton|dye\s+remover)\b/i },
];

// Linhas internas Keraton — nomes de linha específicos que identificam produto errado quando
// a marca Keraton aparece no título mas a família correta não foi encontrada.
// Apenas frases específicas: palavras genéricas como "hidratacao" ou "preto" foram removidas
// pois aparecem em descrições legítimas de qualquer produto.
const INTERNAL_KERATON_LINES = [
  'mais hidratacao',
  'mais hidratação',
  'mais forca',
  'mais força',
  'mais cor',
  'nutri color',
  'keragen',
  'coloridos',
  'mechas',
];

const LINE_PATTERNS = [
  { id: 'dual-block', pattern: /color\s+dual\s+block/i },
  { id: 'selfie-my-crush', pattern: /selfie\s+my\s+crush/i },
  { id: 'selfie', pattern: /\bselfie\b/i },
  { id: 'demi-color', pattern: /demi\s+color/i },
  { id: 'color-cachos', pattern: /color\s+cachos/i },
  { id: 'neon-colors', pattern: /neon\s+colors/i },
  { id: 'hard-color', pattern: /hard\s+colors?/i },
  { id: 'shine-mask', pattern: /shine\s+mask/i },
  { id: 'men', pattern: /\bkeraton\s+men\b/i },
  { id: 'muito-liso', pattern: /muito\s*\+?\s*liso/i },
  { id: 'muito-cachos', pattern: /muito\s*\+?\s*cachos/i },
  { id: 'uso-essencial', pattern: /uso\s+essencial/i },
  { id: 'desmaia-fio', pattern: /desmaia\s+fio/i },
  { id: 'keragen-evolution', pattern: /keragen\s+evolution/i },
  { id: 'mais-cor', pattern: /mais\s+cor/i },
  { id: 'mais-forca', pattern: /mais\s+forca/i },
  { id: 'mais-hidratacao', pattern: /mais\s+hidratacao/i },
];

const TRUSTED_DOMAINS = [
  'mercadolivre.com', 'mercadolivre.com.br',
  'shopee.com.br', 'magazineluiza.com.br', 'americanas.com.br',
  'belezanaweb.com.br', 'epocacosmeticos.com.br', 'drogariasaopaulo.com.br',
  'drogasil.com.br', 'drogaraia.com.br', 'ultrafarma.com.br',
];

function detectType(text) {
  return TYPE_PATTERNS.find((rule) => rule.pattern.test(text)) || null;
}

function detectLine(text) {
  return LINE_PATTERNS.find((rule) => rule.pattern.test(text)) || null;
}

function isTrustedDomain(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
    return TRUSTED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

function includesTerm(text, term) {
  const normalized = normalizeText(term);
  return normalized && text.includes(normalized);
}

function hasLineInText(text, product) {
  const line = product.line || product.family || '';
  if (includesTerm(text, line)) return true;
  return (product.lineAliases || product.familyAliases || []).some((alias) => includesTerm(text, alias));
}

function scoreStatus(score) {
  if (score >= 90) return 'Aprovado';
  if (score >= 45) return 'Revisar';
  if (score >= 20) return 'CandidatoFraco';
  return 'Rejeitado';
}

function rejected(reason) {
  return { score: -150, status: 'Rejeitado', reasons: [{ points: -150, reason }] };
}

function calculateCompatibility(product, listing, learning = {}) {
  const titleText = normalizeText(listing.title || '');
  const text = normalizeText(`${listing.title || ''} ${listing.link || ''}`);
  const parsed = parseListingTitle(listing.title || '');
  const reasons = [];
  let score = 0;
  let capAtRevisar = false;
  const add = (points, reason) => { score += points; reasons.push({ points, reason }); };

  // Travas absolutas — retorno imediato sem análise adicional
  if (COMPETITOR_PATTERN.test(titleText)) return rejected('Marca concorrente no título');
  if (learning.ignoredTitles?.some((t) => normalizeText(t) === normalizeText(listing.title))) {
    return rejected('Título já ignorado');
  }
  if (!Number.isFinite(listing.price) || listing.price <= 0) return rejected('Sem preço');

  // Tipo: rejeita apenas se tipo conflitante for detectado
  const productType = detectType(normalizeText(product.name || ''));
  if (productType) {
    const listingType = detectType(titleText);
    if (listingType) {
      if (listingType.id === productType.id) {
        add(30, `Tipo correto: ${productType.id}`);
      } else {
        return rejected(`Tipo errado: esperado ${productType.id}, encontrado ${listingType.id}`);
      }
    }
    // Sem tipo detectado no título — não penaliza, pode ser título incompleto
  }

  // Kit quando produto é unitário
  const productIsKit = /\b(?:kit|combo|conjunto)\b/.test(normalizeText(product.name || ''));
  if (!productIsKit && !product.aceitaKit && /\b(?:kit|combo|conjunto)\b/.test(text)) {
    add(-60, 'Produto em kit');
  }

  // EAN
  const hasEan = Boolean(product.ean && text.includes(product.ean));
  if (hasEan) add(120, 'EAN encontrado');

  // Marca própria
  const hasKeratonBrand = /\b(?:keraton|kert)\b/.test(text);
  if (hasKeratonBrand) add(35, 'Marca Keraton/Kert');

  // Linha
  const productLineName = product.line || product.family || '';
  if (productLineName) {
    const familyFound = hasLineInText(text, product);
    if (familyFound) {
      add(60, 'Linha correta');
    } else {
      // Linha conflitante via LINE_PATTERNS → trava absoluta
      const productLine = detectLine(normalizeText(productLineName));
      const listingLine = detectLine(text);
      if (productLine && listingLine && productLine.id !== listingLine.id) {
        return rejected(`Linha conflitante: esperada ${productLine.id}, encontrada ${listingLine.id}`);
      }
      // Linha interna Keraton conflitante → trava absoluta (sem EAN confirmado)
      if (!hasEan && hasKeratonBrand) {
        const blockedLine = INTERNAL_KERATON_LINES.find((w) => includesTerm(titleText, w));
        if (blockedLine) return rejected(`Linha Keraton conflitante: "${blockedLine}"`);
      }
      // Palavras que sugerem outra linha Keraton → penalidade forte + cap (não rejeita direto)
      if (!hasEan && product.lineBlockWords?.length) {
        const blocked = product.lineBlockWords.find((w) => includesTerm(titleText, w));
        if (blocked) {
          add(-60, `Possível linha concorrente: "${blocked}"`);
          capAtRevisar = true;
        }
      }
      // Linha ausente sem conflito: penalidade leve + cap Revisar
      if (!hasEan) {
        add(-10, 'Linha não identificada');
        capAtRevisar = true;
      }
    }
  }

  // Volume — detecta correspondência e conflitos de tamanho/embalagem
  if (product.volume) {
    const prodVolNorm = normalizeVolume(product.volume);
    if (prodVolNorm && parsed.volume) {
      if (parsed.volume === prodVolNorm) {
        add(15, 'Volume correto');
      } else {
        add(-20, `Volume divergente: esperado ${product.volume}, encontrado ${parsed.volume}`);
      }
    } else if (includesTerm(text, product.volume)) {
      add(15, 'Volume correto');
    }
  }

  // Nuance — código de tom para coloração (ex: 7.0, 8.1, 5N)
  // Rejeita quando nuances claramente diferentes sem EAN confirmando
  if (product.nuance && parsed.nuance) {
    const prodNuance = normalizeNuance(product.nuance);
    const listNuance = normalizeNuance(parsed.nuance);
    if (listNuance === prodNuance) {
      add(25, `Nuance correta: ${product.nuance}`);
    } else if (!hasEan) {
      return rejected(`Nuance errada: esperado ${product.nuance}, encontrado ${parsed.nuance}`);
    } else {
      add(-40, `Nuance divergente (EAN presente): esperado ${product.nuance}, encontrado ${parsed.nuance}`);
    }
  }

  // Cor — descriptor de cor do produto (ex: Louro Médio, Castanho Escuro)
  if (product.color && parsed.colorId) {
    const prodColorNorm = normalizeText(product.color);
    const listColorNorm = normalizeText(parsed.colorLabel || parsed.colorId);
    const colorMatch = listColorNorm === prodColorNorm
      || listColorNorm.includes(prodColorNorm)
      || prodColorNorm.includes(listColorNorm);
    if (colorMatch) add(10, `Cor correta: ${product.color}`);
    // Sem penalidade por cor divergente — título pode omitir a cor
  }

  // Palavras obrigatórias
  const required = product.requiredWords?.length
    ? product.requiredWords
    : tokenize(product.searchTerm || product.name).slice(0, 3);
  if (required.length) {
    const matched = required.filter((word) => includesTerm(text, word));
    if (matched.length === required.length) {
      add(20, 'Palavras obrigatórias encontradas');
    } else if (matched.length < required.length) {
      add(-10, `Palavras ausentes: ${required.filter((w) => !matched.includes(w)).join(', ')}`);
    }
  }

  // Domínio confiável
  if (listing.link && isTrustedDomain(listing.link)) add(15, 'Domínio confiável');

  // Preço
  add(10, 'Preço encontrado');

  let finalScore = Math.max(-150, Math.min(200, score));
  if (capAtRevisar) finalScore = Math.min(89, finalScore);
  return { score: finalScore, status: scoreStatus(finalScore), reasons };
}

module.exports = { calculateCompatibility, scoreStatus };
