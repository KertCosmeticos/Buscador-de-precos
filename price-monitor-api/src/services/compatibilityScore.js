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

function calculateCompatibility(product, listing, learning = {}) {
  const text = normalizeText(`${listing.title || ''} ${listing.link || ''}`);
  const reasons = [];
  let score = 0;
  const add = (points, reason) => { score += points; reasons.push({ points, reason }); };

  if (product.ean && text.includes(product.ean)) add(100, 'EAN encontrado');
  if (/\b(?:keraton|kert)\b/.test(text)) add(30, 'Marca Keraton/Kert');
  if (product.family && includesTerm(text, product.family)) add(25, 'Linha correta');
  if (product.volume && includesTerm(text, product.volume)) add(10, 'Volume correto');

  const required = product.requiredWords?.length ? product.requiredWords : tokenize(product.searchTerm || product.name).slice(0, 3);
  const requiredMatched = required.filter((word) => includesTerm(text, word));
  if (required.length && requiredMatched.length === required.length) add(25, 'Palavras obrigatórias encontradas');

  const forbidden = [...(product.forbiddenWords || []), ...(learning.excludedWords || [])];
  const foundForbidden = forbidden.find((word) => includesTerm(text, word));
  if (foundForbidden) add(-50, `Palavra proibida: ${foundForbidden}`);
  if (/\b(?:kit|combo|conjunto)\b/.test(text) && !/\b(?:kit|combo|conjunto)\b/.test(normalizeText(product.name))) add(-40, 'Produto em kit');
  if (learning.ignoredTitles?.some((title) => normalizeText(title) === normalizeText(listing.title))) add(-100, 'Título já ignorado');

  const finalScore = Math.max(-100, Math.min(150, score));
  return { score: finalScore, status: scoreStatus(finalScore), reasons };
}

module.exports = { calculateCompatibility, scoreStatus };
