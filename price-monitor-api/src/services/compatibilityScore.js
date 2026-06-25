const { normalizeText, tokenize } = require('../utils/text');

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

function hasFamilyInText(text, product) {
  if (includesTerm(text, product.family)) return true;
  return (product.familyAliases || []).some((alias) => includesTerm(text, alias));
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
  if (/\b(?:keraton|kert)\b/.test(text)) add(35, 'Marca Keraton/Kert');

  // Linha (family)
  if (product.family) {
    const familyFound = hasFamilyInText(text, product);
    if (familyFound) {
      add(60, 'Linha correta');
    } else {
      // Linha conflitante: outra linha detectada → trava absoluta
      const productLine = detectLine(normalizeText(product.family));
      const listingLine = detectLine(text);
      if (productLine && listingLine && productLine.id !== listingLine.id) {
        return rejected(`Linha conflitante: esperada ${productLine.id}, encontrada ${listingLine.id}`);
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

  // Volume
  if (product.volume && includesTerm(text, product.volume)) add(15, 'Volume correto');

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
