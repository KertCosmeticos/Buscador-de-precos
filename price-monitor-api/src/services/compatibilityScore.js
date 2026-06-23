const { normalizeText, tokenize } = require('../utils/text');

const COMPETITOR_PATTERN = new RegExp(
  '\\b(?:' + [
    'acquaflora', 'alfaparf', 'amend', 'anaconda', 'beautycolor', 'biocolor',
    'brae', 'cadiveu', 'casting', 'ckamura', 'clairol', 'colorissimo', 'corton',
    'dove', 'embelleze', 'eudora', 'garnier', 'haskell', 'helpex', 'igora',
    'inoar', 'itallian', 'italianhair', 'kamaleao', 'kamura', 'keune', 'koleston',
    'kostume', 'loreal', 'mairibel', 'maxton', 'natucor', 'niely', 'nivea',
    'novex', 'nutriex', 'pantene', 'redken', 'revlon', 'salon', 'salonline',
    'schwarzkopf', 'skala', 'softcolor', 'truss', 'tresemme', 'wella', 'yama',
    'meu\\s+liso',
  ].join('|') + ')\\b', 'i'
);

function includesTerm(text, term) {
  const normalized = normalizeText(term);
  return normalized && text.includes(normalized);
}

function scoreStatus(score) {
  if (score >= 90) return 'Confirmado';
  if (score >= 70) return 'Provável';
  if (score >= 40) return 'Revisar';
  return 'Ignorar';
}

function buildBrandPattern(ownBrands = []) {
  const base = ['keraton', 'kert', 'phytogen', 'keragen', 'reduton'];
  const all = [...new Set([...base, ...ownBrands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))])];
  return new RegExp(`\\b(?:${all.join('|')})\\b`);
}

function calculateCompatibility(product, listing, ownBrands = []) {
  const text = normalizeText(`${listing.title || ''} ${listing.link || ''} ${listing.seller || ''} ${listing.marketplace || ''}`);
  const reasons = [];
  let score = 0;
  const add = (points, reason) => { score += points; reasons.push({ points, reason }); };

  const titleText = normalizeText(listing.title || '');
  if (COMPETITOR_PATTERN.test(titleText)) add(-100, 'Marca concorrente no título');

  if (product.ean && text.includes(product.ean)) add(100, 'EAN encontrado');
  if (buildBrandPattern(ownBrands).test(text)) add(30, 'Marca própria');
  if (product.family && includesTerm(text, product.family)) add(25, 'Linha correta');
  if (product.volume && includesTerm(text, product.volume)) add(10, 'Volume correto');

  const required = product.tokens?.length ? product.tokens.slice(0, 3) : tokenize(product.name).slice(0, 3);
  const requiredMatched = required.filter((word) => includesTerm(text, word));
  if (required.length && requiredMatched.length === required.length) add(25, 'Palavras obrigatórias encontradas');

  if (/\b(?:kit|combo|conjunto)\b/.test(text) && !/\b(?:kit|combo|conjunto)\b/.test(normalizeText(product.name))) add(-40, 'Produto em kit');

  const finalScore = Math.max(-100, Math.min(150, score));
  return { score: finalScore, status: scoreStatus(finalScore), reasons };
}

module.exports = { calculateCompatibility, scoreStatus };
