const { normalizeText, tokenize, uniqueStrings } = require('../utils/text');

const OWN_BRANDS = ['keraton', 'kert', 'phytogen', 'keragen', 'reduton'];
const TYPE_LABELS = [
  { label: 'shampoo', pattern: /\b(?:shampoo|sh)\b/i },
  { label: 'condicionador', pattern: /\b(?:condicionador|cond)\b/i },
  { label: 'mascara', pattern: /\b(?:mascara|mask|masc)\b/i },
  { label: 'leave-in', pattern: /\bleave[ -]?in\b/i },
  { label: 'oxidante', pattern: /\boxidante\b/i },
  { label: 'serum', pattern: /\bserum\b/i },
  { label: 'oleo', pattern: /\boleo\b/i },
  { label: 'descolorante', pattern: /\b(?:descolorante|blond)\b/i },
];

function expandAbbreviations(text) {
  return String(text || '')
    .replace(/\bsh\b/gi, 'shampoo')
    .replace(/\bcond\b/gi, 'condicionador')
    .replace(/\bmasc\b/gi, 'mascara');
}

function stripVolume(text) {
  return String(text || '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|g|gr|kg|l)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBrand(text) {
  const lower = normalizeText(text);
  return OWN_BRANDS.find((b) => lower.split(/\s+/).includes(b)) || '';
}

function extractTypeLabel(text) {
  const lower = normalizeText(text);
  return TYPE_LABELS.find((t) => t.pattern.test(lower))?.label || '';
}

function dedup(...arrays) {
  const seen = new Set();
  return arrays.flat().filter((t) => {
    const v = String(t || '').trim();
    if (!v || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

// Gera termos em 3 camadas para busca progressiva.
// exact  → buscas de identidade (EAN, nome completo, nome expandido)
// medium → buscas de intenção (sem volume, variantes, aprendizado)
// wide   → buscas de descoberta (marca+tipo, marca+linha, marca)
function generateLayeredTerms(product, learning = {}) {
  const name = product.name || '';
  const expanded = expandAbbreviations(name);
  const noVolume = stripVolume(expanded);
  const noVolumeOrig = stripVolume(name);
  const brand = extractBrand(name);
  const type = extractTypeLabel(name);
  const family = stripVolume(normalizeText(product.line || product.family || ''));
  const category = normalizeText(product.category || '');
  const expandedLine = noVolume.replace(/muito\s+liso/gi, 'muito mais liso');

  const exact = dedup(
    product.ean,
    name,
    expanded !== name ? expanded : null,
  );

  const goodTerms = learning.goodTerms ? [].concat(learning.goodTerms) : [];
  const aliases = [...(product.aliases || []), ...(learning.confirmedAliases || []).slice(0, 2)];
  const medium = dedup(
    noVolume,
    noVolumeOrig !== noVolume ? noVolumeOrig : null,
    expandedLine !== noVolume ? expandedLine : null,
    ...goodTerms,
    ...aliases,
  ).filter((t) => !exact.includes(t));

  const wide = dedup(
    brand && type && family ? `${brand} ${type} ${family}` : null,
    brand && family ? `${brand} ${family}` : null,
    brand && type ? `${brand} ${type}` : null,
    brand && category ? `${brand} ${category}` : null,
    brand || null,
  ).filter((t) => !exact.includes(t) && !medium.includes(t));

  return { exact, medium, wide, siteAliases: product.lineAliases || product.familyAliases || [] };
}

// Interface legada — usado em rotas que ainda esperam array plano de strings.
function generateSearchTerms(product, learning = {}, site = {}) {
  const official = normalizeText(product.name);
  const preferred = normalizeText(product.searchTerm);
  const aliases = [...(learning.confirmedAliases || []), ...(product.aliases || [])];
  const learned = learning.goodTerms || [];
  const terms = [];
  if (site.acceptsEan !== false && product.ean) terms.push(product.ean);
  if (site.acceptsName !== false) {
    terms.push(...learned, preferred, ...aliases, official);
    terms.push(tokenize(official).filter((token) => !/^\d+(?:[.,]\d+)?(?:ml|g|kg|l)$/.test(token)).join(' '));
  }
  const rejected = new Set(uniqueStrings(learning.badTerms));
  return uniqueStrings(terms).filter((term) => !rejected.has(term));
}

module.exports = { generateSearchTerms, generateLayeredTerms };
