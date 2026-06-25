const { normalizeText, tokenize, uniqueStrings } = require('../utils/text');

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

module.exports = { generateSearchTerms };
