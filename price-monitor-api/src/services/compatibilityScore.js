const { normalizeText, tokenize } = require('../utils/text');

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

function calculateCompatibility(product, listing) {
  const text = normalizeText(`${listing.title || ''} ${listing.link || ''} ${listing.seller || ''} ${listing.marketplace || ''}`);
  const reasons = [];
  let score = 0;
  const add = (points, reason) => { score += points; reasons.push({ points, reason }); };

  if (product.ean && text.includes(product.ean)) add(100, 'EAN encontrado');
  if (/\b(?:keraton|kert|phytogen|keragen|reduton)\b/.test(text)) add(30, 'Marca própria');
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
